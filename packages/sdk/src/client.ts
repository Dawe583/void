import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ledgerDir as defaultLedgerDir } from "../../ledger/src/store.ts";
import { verifyLedgerFile } from "../../ledger/src/verify.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import { ApprovalBroker } from "../../policy/src/index.ts";
import type { ApprovalRecord, HeldCall, HoldQueue, PolicyCall } from "../../policy/src/index.ts";
import { PolicyStartupError as ProxyPolicyStartupError, runProxy } from "../../proxy/src/bin.ts";
import type { ProxyPosture, UpstreamEvents } from "../../proxy/src/bin.ts";
import type { JsonObject, JsonRpcError, JsonRpcId, JsonRpcMessage, JsonRpcResult } from "../../proxy/src/rpc.ts";
import { upstreamHttp } from "../../proxy/src/transport/http.ts";

import { HoldDeniedError, LedgerVerifyError, PolicyStartupError } from "./errors.ts";
import { holdHandle } from "./hold.ts";
import type { HoldHandle } from "./hold.ts";

export type VoidConnect =
  | { readonly upstreamCommand: readonly string[]; readonly upstreamEnv?: Record<string, string> }
  | { readonly httpUrl: string; readonly headers?: Readonly<Record<string, string>> };

export type VoidClock = {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type VoidClientOptions = {
  readonly ledgerDir?: string;
  readonly workspace?: string;
  readonly connect: VoidConnect;
  readonly policyPath?: string;
  readonly factsPath?: string;
  readonly posture?: ProxyPosture;
  readonly requestTimeoutMs?: number;
  readonly holdPollMs?: number;
  readonly clock?: VoidClock;
};

export type McpLikeClient = {
  readonly request: (method: string, params?: JsonObject) => Promise<unknown>;
  readonly awaitHold: (holdId: string) => Promise<unknown>;
};

type PendingRequest = {
  readonly id: number;
  readonly method: string;
  readonly params: JsonObject | undefined;
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  holdId: string | undefined;
};

type HoldWaiter = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

type CompletedHold =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: Error };

const defaultClock: VoidClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export class VoidClient implements McpLikeClient {
  readonly approvals = new ApprovalBroker();

  readonly #input = new ScriptInput();
  readonly #ledgerDir: string;
  readonly #workspace: string;
  readonly #connect: VoidConnect;
  readonly #policyPath: string | undefined;
  readonly #factsPath: string | undefined;
  readonly #posture: ProxyPosture;
  readonly #requestTimeoutMs: number;
  readonly #holdPollMs: number;
  readonly #clock: VoidClock;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #registeredHolds = new Set<string>();
  readonly #holdToRequest = new Map<string, number>();
  readonly #holdWaiters = new Map<string, HoldWaiter[]>();
  readonly #completedHolds = new Map<string, CompletedHold>();
  readonly #errors: string[] = [];
  #queue: HoldQueue | undefined;
  #running: Promise<void> | undefined;
  #nextId = 1;
  #closed = false;
  #pumpTimer: unknown;
  #defaultPolicyPath: string | undefined;

  constructor(options: VoidClientOptions) {
    this.#ledgerDir = options.ledgerDir ?? defaultLedgerDir();
    this.#workspace = options.workspace ?? "default";
    this.#connect = options.connect;
    this.#policyPath = options.policyPath;
    this.#factsPath = options.factsPath;
    this.#posture = options.posture ?? "fail-closed";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.#holdPollMs = options.holdPollMs ?? 10;
    this.#clock = options.clock ?? defaultClock;
  }

  get errors(): readonly string[] {
    return [...this.#errors];
  }

  async request(method: string, params?: JsonObject): Promise<unknown> {
    if (this.#closed) throw new Error("VOID client is closed");
    const running = this.#ensureStarted();
    const id = this.#nextId;
    this.#nextId += 1;
    const pending = this.#pendingRequest(id, method, params);
    this.#pending.set(id, pending);
    this.#input.push({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    this.#adoptHolds();
    return this.#withTimeout(
      pending.promise,
      this.#requestTimeoutMs,
      `request ${method} timed out`,
      () => {
        this.#pending.delete(id);
      },
      running,
    );
  }

  async awaitHold(holdId: string): Promise<unknown> {
    this.#adoptHolds();
    const completed = this.#completedHolds.get(holdId);
    if (completed !== undefined) {
      if (completed.ok) return completed.value;
      throw completed.error;
    }

    const requestId = this.#holdToRequest.get(holdId);
    if (requestId !== undefined) {
      const pending = this.#pending.get(requestId);
      if (pending !== undefined) return pending.promise;
    }

    return new Promise((resolve, reject) => {
      const waiters = this.#holdWaiters.get(holdId) ?? [];
      waiters.push({ resolve, reject });
      this.#holdWaiters.set(holdId, waiters);
      this.#adoptHolds();
    });
  }

  hold(holdId: string): HoldHandle {
    return holdHandle(this.approvals, holdId, { pollMs: this.#holdPollMs, clock: this.#clock });
  }

  pendingHolds(): readonly ApprovalRecord[] {
    this.#adoptHolds();
    return this.approvals.pending();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pumpTimer !== undefined) {
      this.#clock.clearTimeout(this.#pumpTimer);
      this.#pumpTimer = undefined;
    }
    this.#input.end();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("VOID client closed"));
    }
    this.#pending.clear();
  }

  #ensureStarted(): Promise<void> {
    if (this.#running !== undefined) return this.#running;
    this.#running = (async () => {
      await this.#verifyLedger();
      const policyPath = this.#policyPath ?? await this.#ensureDefaultPolicyPath();
      const connect = this.#connect;
      const upstreamSpawn = "httpUrl" in connect
        ? (events: UpstreamEvents) => upstreamHttp(new URL(connect.httpUrl), {
            events,
            headers: connect.headers,
          })
        : undefined;
      const upstreamCommand = "upstreamCommand" in connect ? connect.upstreamCommand : ["http", connect.httpUrl];
      const upstreamEnv = "upstreamEnv" in connect ? connect.upstreamEnv : undefined;
      await runProxy({
        upstreamCommand,
        upstreamEnv,
        upstreamSpawn,
        policyPath,
        factsPath: this.#factsPath,
        posture: this.#posture,
        ledgerDir: this.#ledgerDir,
        workspace: this.#workspace,
        input: this.#input,
        output: (line) => { this.#receive(line); },
        error: (line) => { this.#errors.push(line); },
        onHold: (queue) => {
          this.#queue = queue;
          this.#schedulePump();
        },
      });
    })().catch((error: unknown) => {
      const mapped = mapStartupError(error);
      this.#rejectAll(mapped);
      throw mapped;
    }).finally(() => {
      if (!this.#closed) this.#closed = true;
      if (this.#pumpTimer !== undefined) {
        this.#clock.clearTimeout(this.#pumpTimer);
        this.#pumpTimer = undefined;
      }
    });
    return this.#running;
  }

  async #verifyLedger(): Promise<void> {
    const path = join(this.#ledgerDir, `${this.#workspace}.jsonl`);
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    try {
      // Trust the proxy's configured signer, never a key supplied by ledger data.
      const signer = await devKeyProvider();
      const result = await verifyLedgerFile(path, { publicKey: (keyId) => signer.publicKey(keyId) });
      if (!result.ok) {
        throw new LedgerVerifyError(`ledger verification failed: ${result.reason ?? "unknown"}`, {
          reason: result.reason,
          checked: result.checked,
        });
      }
    } catch (error) {
      if (error instanceof LedgerVerifyError) throw error;
      throw new LedgerVerifyError(`ledger verification failed: ${errorMessage(error)}`);
    }
  }

  async #ensureDefaultPolicyPath(): Promise<string> {
    if (this.#defaultPolicyPath !== undefined) return this.#defaultPolicyPath;
    const dir = join(tmpdir(), `void-sdk-${process.pid}-${Date.now().toString(36)}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "policy.yaml");
    await writeFile(path, "version: 1\nrules:\n  - match: {}\n    decision: deny\n    rationale: configure an SDK policy before forwarding writes\n");
    this.#defaultPolicyPath = path;
    return path;
  }

  #pendingRequest(id: number, method: string, params: JsonObject | undefined): PendingRequest {
    let resolvePending: (value: unknown) => void = () => {};
    let rejectPending: (error: Error) => void = () => {};
    const promise = new Promise<unknown>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    return {
      id,
      method,
      params,
      promise,
      resolve: resolvePending,
      reject: rejectPending,
      holdId: undefined,
    };
  }

  #receive(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.#rejectAll(new Error(`proxy returned malformed JSON: ${errorMessage(error)}`));
      return;
    }

    if (!isResponse(message) || message.id === undefined) return;
    const id = numericId(message.id);
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);

    if ("error" in message) {
      const error = errorFromJsonRpc(message, pending.holdId);
      pending.reject(error);
      this.#completeHold(pending, { ok: false, error });
      return;
    }

    pending.resolve(message.result);
    this.#completeHold(pending, { ok: true, value: message.result });
  }

  #completeHold(pending: PendingRequest, completed: CompletedHold): void {
    if (pending.holdId === undefined) return;
    this.#completedHolds.set(pending.holdId, completed);
  }

  #adoptHolds(): void {
    if (this.#queue === undefined) return;
    for (const held of this.#queue.list()) {
      if (this.#registeredHolds.has(held.id)) continue;
      this.approvals.register(this.#queue, callFromHeld(held, this.#workspace));
      this.#registeredHolds.add(held.id);
      this.#bindHoldToPending(held);
    }
  }

  #bindHoldToPending(held: HeldCall): void {
    const pending = [...this.#pending.values()].find((candidate) =>
      candidate.holdId === undefined && candidate.method === "tools/call" && toolName(candidate.params) === held.tool,
    );
    if (pending === undefined) return;
    pending.holdId = held.id;
    this.#holdToRequest.set(held.id, pending.id);
    const waiters = this.#holdWaiters.get(held.id) ?? [];
    this.#holdWaiters.delete(held.id);
    for (const waiter of waiters) {
      pending.promise.then(waiter.resolve, waiter.reject);
    }
  }

  #schedulePump(): void {
    if (this.#pumpTimer !== undefined || this.#closed) return;
    this.#pumpTimer = this.#clock.setTimeout(() => {
      this.#pumpTimer = undefined;
      this.#adoptHolds();
      if (!this.#closed) this.#schedulePump();
    }, this.#holdPollMs);
    if (hasUnref(this.#pumpTimer)) this.#pumpTimer.unref();
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    for (const waiters of this.#holdWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.#holdWaiters.clear();
  }

  #withTimeout(
    promise: Promise<unknown>,
    ms: number,
    message: string,
    onTimeout: () => void,
    running: Promise<void>,
  ): Promise<unknown> {
    if (ms <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = this.#clock.setTimeout(() => {
        onTimeout();
        reject(new Error(message));
      }, ms);
      if (hasUnref(timer)) timer.unref();
      const done = (): void => { this.#clock.clearTimeout(timer); };
      promise.then((value) => {
        done();
        resolve(value);
      }, (error: unknown) => {
        done();
        reject(error);
      });
      running.catch((error: unknown) => {
        done();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

export function createVoidClient(options: VoidClientOptions): VoidClient {
  return new VoidClient(options);
}

class ScriptInput implements AsyncIterable<string>, AsyncIterator<string> {
  readonly #lines: string[] = [];
  readonly #waiters: Array<(result: IteratorResult<string>) => void> = [];
  #done = false;

  push(message: JsonRpcMessage): void {
    this.pushLine(JSON.stringify(message));
  }

  pushLine(line: string): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: line, done: false });
      return;
    }
    this.#lines.push(line);
  }

  end(): void {
    this.#done = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this;
  }

  next(): Promise<IteratorResult<string>> {
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve({ value: line, done: false });
    if (this.#done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => { this.#waiters.push(resolve); });
  }

  return(): Promise<IteratorResult<string>> {
    this.end();
    return Promise.resolve({ value: undefined, done: true });
  }
}

function callFromHeld(held: HeldCall, workspace: string): PolicyCall {
  return {
    tool: held.tool,
    connector: connectorFromName(held.tool),
    workspace,
    klass: held.klass,
    blastRadius: held.blastRadius,
  };
}

function connectorFromName(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function toolName(params: JsonObject | undefined): string | undefined {
  const name = params?.name;
  return typeof name === "string" ? name : undefined;
}

function isResponse(message: JsonRpcMessage): message is JsonRpcResult | JsonRpcError {
  return "result" in message || "error" in message;
}

function numericId(id: JsonRpcId): number {
  if (typeof id === "number") return id;
  const parsed = Number(id);
  if (Number.isInteger(parsed)) return parsed;
  throw new Error(`response id is not numeric: ${id}`);
}

function errorFromJsonRpc(message: JsonRpcError, holdId: string | undefined): Error {
  const data = message.error.data;
  if (isObject(data) && (data.result === "denied" || data.result === "expired")) {
    return new HoldDeniedError(message.error.message, { holdId, data });
  }
  return new Error(message.error.message);
}

function mapStartupError(error: unknown): Error {
  if (error instanceof LedgerVerifyError) return error;
  if (error instanceof ProxyPolicyStartupError) return new PolicyStartupError(error.message);
  return error instanceof Error ? error : new Error(String(error));
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnref(value: unknown): value is { readonly unref: () => void } {
  return typeof value === "object" && value !== null && "unref" in value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
