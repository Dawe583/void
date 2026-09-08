import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProxy } from "./bin.ts";
import { assertInboundLineCeiling, assertSingleJsonRpcMessage } from "./hardening.ts";
import type { ProxyShutdownSignal, ProxyShutdownSignals, UpstreamEvents } from "./bin.ts";
import type { HoldQueue } from "../../policy/src/hold.ts";
import type { UpstreamProcess } from "./transport/stdio.ts";

describe("proxy hardening helpers", () => {
  test("inboundLineCeiling rejects oversized lines before JSON parse", () => {
    assert.doesNotThrow(() => assertInboundLineCeiling("12345", 5));
    assert.throws(() => assertInboundLineCeiling("123456", 5), /exceeded 5 bytes/);
  });

  test("batch arrays are invalid JSON-RPC messages", () => {
    assert.throws(() => assertSingleJsonRpcMessage([]), /batch requests are not supported/);
  });

  test("id null is refused at the MCP boundary", () => {
    assert.throws(
      () => assertSingleJsonRpcMessage({ jsonrpc: "2.0", id: null, method: "tools/list" }),
      /id null/,
    );
  });
});

describe("runProxy hardening", () => {
  test("JSON-RPC batch input is rejected locally", async () => {
    const harness = await makeHarness();

    await harness.runRaw([JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])]);

    assert.deepEqual(harness.upstreamMessages, []);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    ]);
  });

  test("null ids are rejected locally", async () => {
    const harness = await makeHarness();

    await harness.runRaw([JSON.stringify({ jsonrpc: "2.0", id: null, method: "tools/list" })]);

    assert.deepEqual(harness.upstreamMessages, []);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    ]);
  });

  test("oversized inbound lines are rejected without echoing the payload", async () => {
    const harness = await makeHarness(12);
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { secret: "hunter2" } });

    await harness.runRaw([payload]);

    assert.deepEqual(harness.upstreamMessages, []);
    const rendered = JSON.stringify(harness.outputMessages);
    assert.match(rendered, /Invalid Request/);
    assert.doesNotMatch(rendered, /hunter2|tools\/list/);
  });



  test("SIGTERM drains held calls as expired before shutdown", async () => {
    const signals = fakeSignals();
    const harness = await makeHoldHarness(signals);
    const running = harness.runRaw([JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/call", params: { name: "aws.s3.bucket.delete", arguments: {} } })]);

    await waitFor(() => harness.queue?.list().length === 1, "held call");
    signals.emit("SIGTERM");
    await running;

    assert.equal(signals.exitCode, 143);
    assert.deepEqual(harness.upstreamMessages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string; readonly data: { readonly result: string } } };
    assert.equal(error.id, 77);
    assert.match(error.error.message, /expired without a human decision/);
    assert.equal(error.error.data.result, "expired");
  });

  test("parse errors do not echo malformed input", async () => {
    const harness = await makeHarness();

    await harness.runRaw(["not json with secret hunter2"]);

    const rendered = JSON.stringify(harness.outputMessages);
    assert.match(rendered, /Parse error/);
    assert.doesNotMatch(rendered, /hunter2|not json/);
  });
});

type Harness = {
  readonly upstreamMessages: Array<Record<string, unknown>>;
  readonly outputMessages: unknown[];
  readonly runRaw: (lines: readonly string[]) => Promise<void>;
};

async function makeHarness(inboundMaxBytes?: number): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "void-proxy-hardening-"));
  const policyPath = join(dir, "policy.yml");
  await writeFile(policyPath, "version: 1\nrules:\n  - match: {}\n    decision: allow\n");
  const upstreamMessages: Array<Record<string, unknown>> = [];
  const outputMessages: unknown[] = [];
  return {
    upstreamMessages,
    outputMessages,
    async runRaw(lines) {
      await runProxy({
        upstreamCommand: ["fake"],
        policyPath,
        posture: "observe",
        input: fromLines(lines),
        output(line) { outputMessages.push(JSON.parse(line) as unknown); },
        error() {},
        inboundMaxBytes,
        upstreamSpawn(events) {
          return fakeUpstream(events, upstreamMessages);
        },
      });
    },
  };
}

function fakeUpstream(_events: UpstreamEvents, seen: Array<Record<string, unknown>>): UpstreamProcess {
  return {
    send(line) {
      seen.push(JSON.parse(line) as Record<string, unknown>);
    },
    close() {},
    onStderr() { return () => {}; },
  };
}

async function* fromLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}


type SignalHarness = ProxyShutdownSignals & {
  readonly emit: (signal: ProxyShutdownSignal) => void;
  exitCode?: number;
};

function fakeSignals(): SignalHarness {
  const handlers = new Map<ProxyShutdownSignal, Set<() => void>>([
    ["SIGINT", new Set()],
    ["SIGTERM", new Set()],
  ]);
  return {
    on(signal, handler) { handlers.get(signal)?.add(handler); },
    off(signal, handler) { handlers.get(signal)?.delete(handler); },
    setExitCode(code) { this.exitCode = code; },
    emit(signal) {
      for (const handler of handlers.get(signal) ?? []) handler();
    },
  };
}

async function makeHoldHarness(signals: ProxyShutdownSignals): Promise<Harness & { queue: HoldQueue | null }> {
  const dir = await mkdtemp(join(tmpdir(), "void-proxy-hardening-hold-"));
  const policyPath = join(dir, "policy.yml");
  await writeFile(policyPath, "version: 1\nrules:\n  - match: {}\n    decision: hold\n    seconds: 60\n    notify: [cli]\n");
  const upstreamMessages: Array<Record<string, unknown>> = [];
  const outputMessages: unknown[] = [];
  const harness: Harness & { queue: HoldQueue | null } = {
    upstreamMessages,
    outputMessages,
    queue: null,
    async runRaw(lines) {
      await runProxy({
        upstreamCommand: ["fake"],
        policyPath,
        posture: "fail-closed",
        ledgerDir: await mkdtemp(join(tmpdir(), "void-proxy-hardening-ledger-")),
        workspace: "test",
        input: fromLines(lines),
        output(line) { outputMessages.push(JSON.parse(line) as unknown); },
        error() {},
        shutdownSignals: signals,
        onHold(queue) { harness.queue = queue; },
        upstreamSpawn(events) {
          return fakeUpstream(events, upstreamMessages);
        },
      });
    },
  };
  return harness;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}
