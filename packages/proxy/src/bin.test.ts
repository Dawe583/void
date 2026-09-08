import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProxy } from "./bin.ts";
import type { ProxyOptions, UpstreamEvents } from "./bin.ts";
import type { HoldQueue } from "../../policy/src/index.ts";
import type { UpstreamProcess } from "./transport/stdio.ts";

describe("runProxy", () => {
  test("initialize negotiation answers a version the agent supports", async () => {
    const harness = await makeHarness("allow");

    await harness.run([
      { jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } },
    ]);

    assert.equal(harness.upstreamMessages[0]?.method, "initialize");
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 10, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } },
    ]);
  });

  test("tools call allow forwards and maps the upstream result back", async () => {
    const harness = await makeHarness("allow");

    await harness.run([toolCall(21, "aws.s3.bucket.delete")]);

    assert.equal(harness.upstreamMessages.length, 1);
    assert.equal(harness.upstreamMessages[0]?.id, 1);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 21, result: { called: "aws.s3.bucket.delete" } },
    ]);
  });

  test("tools call deny answers locally and does not send upstream", async () => {
    const harness = await makeHarness("deny");

    await harness.run([toolCall(22, "aws.s3.bucket.delete")]);

    assert.deepEqual(harness.upstreamMessages, []);
    assert.equal(harness.outputMessages.length, 1);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string } };
    assert.equal(error.id, 22);
    assert.match(error.error.message, /denied/);
    assert.match(error.error.message, /Do not retry/);
  });

  test("held call approved then forwards", async () => {
    const harness = await makeHarness("hold");
    let queue: HoldQueue | null = null;
    harness.onHold = (q) => { queue = q; };
    queueMicrotask(async () => {
      const q = await waitForQueue(() => queue);
      q.resolve(q.list()[0]!.id, { kind: "approved" });
    });

    await harness.run([toolCall(23, "aws.s3.bucket.delete")]);

    assert.equal(harness.upstreamMessages.length, 1);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 23, result: { called: "aws.s3.bucket.delete" } },
    ]);
  });

  test("held call denied answers with the readable hold error", async () => {
    const harness = await makeHarness("hold");
    let queue: HoldQueue | null = null;
    harness.onHold = (q) => { queue = q; };
    queueMicrotask(async () => {
      const q = await waitForQueue(() => queue);
      q.resolve(q.list()[0]!.id, { kind: "denied", by: "test" });
    });

    await harness.run([toolCall(24, "aws.s3.bucket.delete")]);

    assert.deepEqual(harness.upstreamMessages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string } };
    assert.equal(error.id, 24);
    assert.match(error.error.message, /was denied by a human/);
    assert.match(error.error.message, /Do not retry/);
  });

  test("observe posture forwards a denied call and logs it", async () => {
    const harness = await makeHarness("deny", "observe");

    await harness.run([toolCall(25, "aws.s3.bucket.delete")]);

    assert.equal(harness.upstreamMessages.length, 1);
    assert.match(harness.errors.join("\n"), /observe: deny verdict/);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 25, result: { called: "aws.s3.bucket.delete" } },
    ]);
  });

  test("malformed stdin line gets a JSON-RPC parse error", async () => {
    const harness = await makeHarness("allow");

    await harness.runRaw(["not json"]);

    assert.deepEqual(harness.upstreamMessages, []);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: Unexpected token 'o', \"not json\" is not valid JSON" } },
    ]);
  });

  test("upstream exit drains held calls as expired", async () => {
    const harness = await makeHarness("hold");
    let events: UpstreamEvents | null = null;
    harness.captureEvents = (e) => { events = e; };
    let queue: HoldQueue | null = null;
    harness.onHold = (q) => { queue = q; };
    queueMicrotask(async () => {
      await waitForQueue(() => queue);
      events?.onClose(1, null);
    });

    await harness.run([toolCall(26, "aws.s3.bucket.delete")]);

    assert.deepEqual(harness.upstreamMessages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string; readonly data: { readonly result: string } } };
    assert.equal(error.id, 26);
    assert.match(error.error.message, /expired without a human decision/);
    assert.equal(error.error.data.result, "expired");
  });
});

type Decision = "allow" | "deny" | "hold";
type Harness = {
  readonly upstreamMessages: Array<Record<string, unknown>>;
  readonly outputMessages: unknown[];
  readonly errors: string[];
  onHold?: (queue: HoldQueue) => void;
  captureEvents?: (events: UpstreamEvents) => void;
  readonly run: (messages: readonly Record<string, unknown>[]) => Promise<void>;
  readonly runRaw: (lines: readonly string[]) => Promise<void>;
};

async function makeHarness(decision: Decision, posture: ProxyOptions["posture"] = "fail-closed"): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "void-proxy-"));
  const policyPath = join(dir, "policy.yml");
  await writeFile(policyPath, policyText(decision));
  const upstreamMessages: Array<Record<string, unknown>> = [];
  const outputMessages: unknown[] = [];
  const errors: string[] = [];

  const harness: Harness = {
    upstreamMessages,
    outputMessages,
    errors,
    run(messages) {
      return this.runRaw(messages.map((message) => JSON.stringify(message)));
    },
    async runRaw(lines) {
      await runProxy({
        upstreamCommand: ["fake"],
        policyPath,
        posture,
        // Fail-closed tests exercise the real ledger path, so every harness
        // gets its own directory: a shared one would let records from one
        // test chain into another's expectations.
        ledgerDir: await mkdtemp(join(tmpdir(), "void-bin-test-")),
        workspace: "test",
        input: fromLines(lines),
        output(line) { outputMessages.push(JSON.parse(line) as unknown); },
        error(line) { errors.push(line); },
        onHold: (queue) => harness.onHold?.(queue),
        upstreamSpawn(events) {
          harness.captureEvents?.(events);
          return fakeUpstream(events, upstreamMessages);
        },
      });
    },
  };
  return harness;
}

function fakeUpstream(events: UpstreamEvents, seen: Array<Record<string, unknown>>): UpstreamProcess {
  return {
    send(line) {
      const message = JSON.parse(line) as { readonly id?: number; readonly method?: string; readonly params?: { readonly name?: string } };
      seen.push(message as Record<string, unknown>);
      if (message.method === "initialize") {
        events.onMessage(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } },
        }));
        return;
      }
      if (message.method === "tools/call") {
        events.onMessage(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { called: message.params?.name } }));
      }
    },
    close() {},
    onStderr() { return () => {}; },
  };
}

async function* fromLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

function policyText(decision: Decision): string {
  if (decision === "allow") return "version: 1\nrules:\n  - match: {}\n    decision: allow\n";
  if (decision === "deny") return "version: 1\nrules:\n  - match: {}\n    decision: deny\n    rationale: tests deny r3\n";
  return "version: 1\nrules:\n  - match: {}\n    decision: hold\n    seconds: 60\n    notify: [cli]\n    rationale: tests hold r3\n";
}

function toolCall(id: number, name: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } };
}

async function waitForQueue(getQueue: () => HoldQueue | null): Promise<HoldQueue> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const queue = getQueue();
    if (queue !== null && queue.list().length > 0) return queue;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("queue was not populated");
}
