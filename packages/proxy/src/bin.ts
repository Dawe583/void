import { createInterface } from "node:readline";
import process from "node:process";
import { readFile } from "node:fs/promises";

import { classifyTool, loadFacts, toEvaluationContext, validateFactsFile } from "../../registry/src/index.ts";
import type { FactsFile, FactsReport } from "../../registry/src/index.ts";
import { decide, HoldQueue, loadPolicy } from "../../policy/src/index.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import { jsonlStore } from "../../ledger/src/store.ts";
import type { JsonlEntry, JsonlReceipt } from "../../ledger/src/store.ts";
import type { LedgerStore } from "../../ledger/src/index.ts";
import type { LoadedPolicy, PolicyCall, PolicyDecision } from "../../policy/src/index.ts";

import { forwardPromptMessage } from "./forward/prompts.ts";
import { forwardResourceMessage } from "./forward/resources.ts";
import { interceptCall } from "./forward/tools.ts";
import type { InterceptedCall, JsonRpcError, JsonRpcResult } from "./forward/tools.ts";
import type { JsonObject, JsonRpcErrorBody, JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest } from "./rpc.ts";
import { relayNotification } from "./relay/notifications.ts";
import { relayServerRequest, relayServerResponse } from "./relay/requests.ts";
import type { JsonRpcResponse } from "./relay/requests.ts";
import { Session } from "./session.ts";
import { DEFAULT_INBOUND_MAX_BYTES, JsonRpcInputError, assertInboundLineCeiling, assertSingleJsonRpcMessage } from "./hardening.ts";
import { spawnUpstream } from "./transport/stdio.ts";
import { upstreamHttp } from "./transport/http.ts";
import type { UpstreamProcess } from "./transport/stdio.ts";

export type ProxyPosture = "fail-closed" | "observe" | "observe-only";
export type ProxyTransport = "stdio" | "http";
export type ProxyShutdownSignal = "SIGINT" | "SIGTERM";

export type ProxyShutdownSignals = {
  readonly on: (signal: ProxyShutdownSignal, handler: () => void) => void;
  readonly off: (signal: ProxyShutdownSignal, handler: () => void) => void;
  readonly setExitCode?: (code: number) => void;
};

export const SUPPORTED_TRANSPORTS: readonly ProxyTransport[] = ["stdio", "http"];

export type UpstreamEvents = {
  readonly onMessage: (line: string) => void;
  readonly onClose: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onError: (error: Error) => void;
};

export type ProxyOptions = {
  readonly upstreamCommand?: readonly string[];
  readonly upstreamEnv?: Record<string, string>;
  readonly transport?: ProxyTransport;
  readonly upstreamUrl?: string;
  readonly policyPath: string;
  readonly factsPath?: string;
  readonly posture: ProxyPosture;
  readonly onHold?: (queue: HoldQueue) => void | (() => void);
  /** Ledger directory for the dev tier store. Required for the fail-closed posture. */
  readonly ledgerDir?: string;
  readonly workspace?: string;
  readonly upstreamSpawn?: (events: UpstreamEvents) => UpstreamProcess;
  readonly input?: AsyncIterable<string>;
  readonly output?: (line: string) => void;
  readonly error?: (line: string) => void;
  readonly inboundMaxBytes?: number;
  readonly shutdownSignals?: ProxyShutdownSignals | false;
};

type InitializeRequest = {
  readonly agentId: JsonRpcId;
  readonly requestedVersion: string;
};

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

export async function runProxy(options: ProxyOptions): Promise<void> {
  const write = options.output ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const writeError = options.error ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const inboundMaxBytes = options.inboundMaxBytes ?? DEFAULT_INBOUND_MAX_BYTES;
  const startup = validateStartup(options, writeError);
  let policy: LoadedPolicy;
  let facts: FactsReport;
  try {
    policy = await readPolicy(options.policyPath);
    facts = await readFacts(options.factsPath);
  } catch (error) {
    writeError(`startup failed: ${errorMessage(error)}`);
    throw error;
  }
  if (options.posture === "fail-closed" && options.ledgerDir === undefined) {
    // The fail-closed posture promises every decided call leaves a ledger
    // record. Without a ledger directory that promise cannot be kept, so the
    // proxy refuses at startup instead of crashing on the first tools/call.
    throw new Error("fail-closed posture requires a ledger directory");
  }
  const session = new Session();
  const queue = new HoldQueue();
  const stopHold = options.onHold?.(queue);
  // The dev tier ledger is a JSONL file store with a local ed25519 signer. In the
  // fail-closed posture the store must open before the first call routes, because
  // the posture promises that a call without a ledger record never forwards.
  const ledgerStore: LedgerStore<unknown, JsonlEntry, JsonlReceipt> | undefined =
    options.ledgerDir === undefined ? undefined : jsonlStore(await devKeyProvider(), { dir: options.ledgerDir });
  let resolveUpstreamClosed: () => void = () => {};
  const upstreamClosed = new Promise<void>((resolve) => { resolveUpstreamClosed = resolve; });

  const initializeByUpstream = new Map<JsonRpcId, InitializeRequest>();
  let upstream: UpstreamProcess | null = null;

  const sendJson = (message: unknown): void => {
    write(JSON.stringify(message));
  };
  const sendUpstream = (message: unknown): void => {
    if (upstream === null) throw new Error("upstream is not open");
    upstream.send(JSON.stringify(message));
  };

  const forwardAfterTranslate = (request: JsonRpcRequest): JsonRpcRequest => {
    const translated = session.translateRequestOut(request);
    sendUpstream(translated);
    return translated;
  };

  const handleUpstreamLine = (line: string): void => {
    let message: JsonRpcMessage;
    try {
      message = parseMessage(line, inboundMaxBytes);
    } catch {
      writeError("upstream sent malformed JSON-RPC message");
      return;
    }

    if (isRequest(message)) {
      sendJson(relayServerRequest(message, session));
      return;
    }

    if (isNotification(message)) {
      const relayed = relayNotification(message, session.maps).notification;
      sendJson(relayed);
      return;
    }

    if (isResponse(message) && message.id !== undefined && initializeByUpstream.has(message.id)) {
      const init = initializeByUpstream.get(message.id)!;
      initializeByUpstream.delete(message.id);
      const translated = session.translateInbound(message);
      if (translated !== null) sendJson(rewriteInitializeResult(translated, session, init));
      return;
    }

    const translated = session.translateInbound(message);
    if (translated !== null) sendJson(translated);
  };

  let drained = false;
  let upstreamClosedFlag = false;
  const drainHolds = (): void => {
    if (drained) return;
    drained = true;
    if (typeof stopHold === "function") stopHold();
    queue.close();
  };
  const shutdown = (): void => {
    drainHolds();
    if (!upstreamClosedFlag) upstream?.close();
    resolveUpstreamClosed();
  };

  const handleUpstreamClose = (): void => {
    upstreamClosedFlag = true;
    drainHolds();
    resolveUpstreamClosed();
  };

  try {
    const upstreamEvents: UpstreamEvents = {
      onMessage: handleUpstreamLine,
      onClose: handleUpstreamClose,
      onError(error) { writeError(`upstream error: ${error.message}`); },
    };
    upstream = startup.transport === "http"
      ? upstreamHttp(startup.url, { events: upstreamEvents })
      : options.upstreamSpawn === undefined
        ? spawnUpstream(startup.command, options.upstreamEnv ?? cleanEnv(process.env), { events: upstreamEvents })
        : options.upstreamSpawn(upstreamEvents);
  } catch (error) {
    throw new UpstreamStartError(errorMessage(error));
  }

  const shutdownSignals = options.shutdownSignals === false ? null : options.shutdownSignals ?? processShutdownSignals();
  const sigint = (): void => {
    shutdownSignals?.setExitCode?.(130);
    shutdown();
  };
  const sigterm = (): void => {
    shutdownSignals?.setExitCode?.(143);
    shutdown();
  };
  shutdownSignals?.on("SIGINT", sigint);
  shutdownSignals?.on("SIGTERM", sigterm);

  const handleAgentLine = async (line: string): Promise<void> => {
    let message: JsonRpcMessage;
    try {
      message = parseMessage(line, inboundMaxBytes);
    } catch (error) {
      const failure = parseFailure(error);
      sendJson(jsonRpcError(null, failure.code, failure.message));
      return;
    }

    const responseId = "id" in message && message.id !== undefined ? message.id : null;
    try {
      if (isRequest(message)) {
        if (message.method === "initialize") {
          const translated = session.translateRequestOut(message);
          initializeByUpstream.set(translated.id, {
            agentId: message.id,
            requestedVersion: readProtocolVersion(message.params),
          });
          sendUpstream(translated);
          return;
        }

        if (message.method === "tools/call") {
          await handleToolCall(message, policy, facts, queue, forwardAfterTranslate, sendJson, writeError, normalizePosture(options.posture), ledgerStore, options.workspace ?? "default");
          return;
        }

        if (isResourceMethod(message.method)) {
          await forwardResourceMessage(message, async (request) => forwardAfterTranslate(request));
          return;
        }

        if (isPromptMethod(message.method)) {
          await forwardPromptMessage(message, async (request) => forwardAfterTranslate(request));
          return;
        }

        forwardAfterTranslate(message);
        return;
      }

      if (isNotification(message)) {
        const cancel = cancellationFromAgent(message, session);
        if (cancel !== null) {
          sendUpstream(cancel);
          return;
        }
        sendUpstream(relayNotification(message, session.maps).notification);
        return;
      }

      sendUpstream(relayServerResponse(message as JsonRpcResponse, session));
    } catch (error) {
      writeError(`request failed: ${errorMessage(error)}`);
      sendJson(jsonRpcError(responseId, INTERNAL_ERROR, "Internal error"));
    }
  };

  const input = (options.input ?? stdinLines())[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await Promise.race([
        input.next(),
        upstreamClosed.then(() => ({ done: true, value: undefined } as IteratorResult<string>)),
      ]);
      if (next.done === true) break;
      await handleAgentLine(next.value);
    }
  } finally {
    shutdownSignals?.off("SIGINT", sigint);
    shutdownSignals?.off("SIGTERM", sigterm);
    await input.return?.();
    shutdown();
  }
}

export class PolicyStartupError extends Error {}
export class ProxyStartupError extends Error {}
export class UpstreamStartError extends Error {}

type StartupConfig =
  | { readonly transport: "stdio"; readonly command: readonly string[] }
  | { readonly transport: "http"; readonly url: URL };

function validateStartup(options: ProxyOptions, writeError: (line: string) => void): StartupConfig {
  const transport = options.transport ?? "stdio";
  if (!isSupportedProxyTransport(transport)) {
    throw new ProxyStartupError(`transport must be one of ${SUPPORTED_TRANSPORTS.join(", ")}`);
  }

  if (transport === "http") {
    if (options.upstreamUrl === undefined || options.upstreamUrl === "") {
      const error = new ProxyStartupError("http transport requires upstreamUrl");
      writeError(`startup failed: ${error.message}`);
      throw error;
    }
    try {
      return { transport, url: new URL(options.upstreamUrl) };
    } catch (error) {
      throw new ProxyStartupError(`invalid upstreamUrl: ${errorMessage(error)}`);
    }
  }

  if (options.upstreamUrl !== undefined) {
    writeError("startup warning: upstreamUrl is ignored for stdio transport");
  }
  if (options.upstreamSpawn === undefined && (options.upstreamCommand === undefined || options.upstreamCommand.length === 0)) {
    throw new UpstreamStartError("stdio transport requires an upstream command");
  }
  return { transport, command: options.upstreamCommand ?? [] };
}

function isSupportedProxyTransport(value: string): value is ProxyTransport {
  return (SUPPORTED_TRANSPORTS as readonly string[]).includes(value);
}

function processShutdownSignals(): ProxyShutdownSignals {
  return {
    on(signal, handler) { process.on(signal, handler); },
    off(signal, handler) { process.off(signal, handler); },
    setExitCode(code) { process.exitCode = code; },
  };
}

async function readPolicy(path: string): Promise<LoadedPolicy> {
  const text = await readFile(path, "utf8");
  const loaded = loadPolicy(text);
  if (!loaded.ok) throw new PolicyStartupError(loaded.errors.join("; "));
  return loaded;
}

async function readFacts(path: string | undefined): Promise<FactsReport> {
  if (path === undefined) return loadFacts({ facts: {} }, new Date());
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const errors = validateFactsFile(raw);
  if (errors.length > 0) throw new PolicyStartupError(errors.join("; "));
  return loadFacts(raw as FactsFile, new Date());
}

async function handleToolCall(
  request: JsonRpcRequest,
  policy: LoadedPolicy,
  facts: FactsReport,
  queue: HoldQueue,
  forward: (request: JsonRpcRequest) => JsonRpcRequest,
  sendJson: (message: unknown) => void,
  writeError: (line: string) => void,
  posture: "fail-closed" | "observe",
  ledgerStore: LedgerStore<unknown, JsonlEntry, JsonlReceipt> | undefined,
  workspace: string,
): Promise<void> {
  const call = interceptedCall(request);
  let lastPolicyCall: PolicyCall | null = null;
  let lastDecision: PolicyDecision | null = null;
  const policyFn = (policyCall: PolicyCall): PolicyDecision => {
    lastPolicyCall = policyCall;
    const decision = decide(policy, policyCall);
    lastDecision = decision;
    if (posture === "observe" && decision.kind !== "allow") {
      writeError(`observe: ${decision.kind} verdict for ${policyCall.tool} forwarded`);
      return { kind: "allow" };
    }
    return decision;
  };

  const verdict = await interceptCall(call, {
    classify: () => classifyTool(call.tool, toEvaluationContext(facts, call.args)),
    policy: policyFn,
    hold: (seconds) => {
      const decision = lastDecision;
      const policyCall = lastPolicyCall;
      if (decision === null || decision.kind !== "hold" || policyCall === null) throw new Error("hold decision state missing");
      return queue.hold({
        tool: call.tool,
        klass: policyCall.klass,
        blastRadius: policyCall.blastRadius,
        ruleIndex: decision.ruleIndex,
        rationale: decision.rationale,
        args: call.args,
        notify: decision.notify,
      }, seconds);
    },
    ledger: async (entry) => {
      // Fail-closed startup already refuses to run without a store. Reaching
      // here without one can only be observe posture, which degrades to a
      // loud stderr note per call rather than blocking the trial it exists
      // for; silently recording nothing would be the dishonest middle.
      if (ledgerStore === undefined) {
        writeError(`observe: no ledger directory, record skipped for ${entry.tool}`);
        return;
      }
      await ledgerStore.append({ ...entry, workspace });
    },
  });

  if (verdict.kind === "allow") {
    forward(request);
    return;
  }

  if (verdict.kind === "deny") {
    sendJson({ ...verdict.error, id: request.id });
    return;
  }

  const held = await verdict.promise;
  if ("error" in held) {
    sendJson({ ...held, id: request.id });
    return;
  }
  forward(request);
}

function interceptedCall(request: JsonRpcRequest): InterceptedCall {
  const params = request.params ?? {};
  const name = params.name;
  const args = params.arguments;
  if (typeof name !== "string" || name === "") throw new TypeError("tools/call params.name is required");
  if (args !== undefined && !isObject(args)) throw new TypeError("tools/call params.arguments must be an object");
  return {
    tool: name,
    connector: connectorFromName(name),
    args: args === undefined ? {} : args,
  };
}

function connectorFromName(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function rewriteInitializeResult(message: JsonRpcMessage, session: Session, init: InitializeRequest): JsonRpcMessage {
  if (!("result" in message) || !isObject(message.result)) return message;
  const upstreamVersion = typeof message.result.protocolVersion === "string" ? message.result.protocolVersion : init.requestedVersion;
  return {
    ...message,
    id: init.agentId,
    result: {
      ...message.result,
      protocolVersion: session.negotiatedVersion(init.requestedVersion, upstreamVersion),
    },
  };
}

function cancellationFromAgent(notification: JsonRpcNotification, session: Session): JsonRpcNotification | null {
  if (notification.method !== "notifications/cancelled") return null;
  const params = notification.params;
  if (params === undefined) return null;
  const requestId = params.requestId;
  if (typeof requestId !== "number") return null;
  return session.translateCancellation(requestId);
}

async function* stdinLines(): AsyncIterable<string> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

function parseMessage(line: string, maxBytes = DEFAULT_INBOUND_MAX_BYTES): JsonRpcMessage {
  assertInboundLineCeiling(line, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new JsonRpcInputError("parse", "Parse error");
  }
  assertSingleJsonRpcMessage(parsed);
  return parsed;
}

function parseFailure(error: unknown): { readonly code: number; readonly message: string } {
  if (error instanceof JsonRpcInputError) {
    return { code: error.kind === "parse" ? PARSE_ERROR : INVALID_REQUEST, message: error.kind === "parse" ? "Parse error" : "Invalid Request" };
  }
  return { code: INVALID_REQUEST, message: "Invalid Request" };
}

function jsonRpcError(id: JsonRpcId | null, code: number, message: string, data?: unknown): { readonly jsonrpc: "2.0"; readonly id: JsonRpcId | null; readonly error: JsonRpcErrorBody } {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

function isResponse(message: JsonRpcMessage): message is JsonRpcResult | JsonRpcError {
  return "result" in message || "error" in message;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProtocolVersion(params: JsonObject | undefined): string {
  return typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-11-25";
}

function isResourceMethod(method: string): boolean {
  return method === "resources/list" || method === "resources/read" || method === "resources/subscribe" || method === "resources/unsubscribe";
}

function isPromptMethod(method: string): boolean {
  return method === "prompts/list" || method === "prompts/get";
}

function normalizePosture(posture: ProxyPosture): "fail-closed" | "observe" {
  return posture === "observe" || posture === "observe-only" ? "observe" : "fail-closed";
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
