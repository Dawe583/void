import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { ProxyStartupError, runProxy } from "./bin.ts";
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
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
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

  test("http transport initialize forwards through the upstream URL", async () => {
    const server = await startHttpUpstream();
    const harness = await makeHttpHarness(server, "allow");
    const run = harness.start();

    harness.input.push(JSON.stringify({ jsonrpc: "2.0", id: 31, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } }));
    await waitFor(() => harness.outputMessages.length === 1, "http initialize response");
    harness.input.close();
    await run;
    await server.close();

    assert.equal(server.messages[0]?.method, "initialize");
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 31, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake-http", version: "1" } } },
    ]);
  });

  test("http transport tools call allow forwards and maps result", async () => {
    const server = await startHttpUpstream();
    const harness = await makeHttpHarness(server, "allow");
    const run = harness.start();

    harness.input.push(JSON.stringify(toolCall(32, "aws.s3.bucket.delete")));
    await waitFor(() => harness.outputMessages.length === 1, "http allow response");
    harness.input.close();
    await run;
    await server.close();

    assert.equal(server.messages.length, 1);
    assert.equal(server.messages[0]?.id, 1);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 32, result: { called: "aws.s3.bucket.delete" } },
    ]);
  });

  test("http transport held call parks until approval and records the ledger", async () => {
    const server = await startHttpUpstream();
    const harness = await makeHttpHarness(server, "hold");
    let queue: HoldQueue | null = null;
    harness.onHold = (q) => { queue = q; };
    const run = harness.start();

    harness.input.push(JSON.stringify(toolCall(33, "aws.s3.bucket.delete")));
    const q = await waitForQueue(() => queue);
    assert.equal(server.messages.length, 0);
    q.resolve(q.list()[0]!.id, { kind: "approved" });
    await waitFor(() => harness.outputMessages.length === 1, "http held response");
    harness.input.close();
    await run;
    await server.close();

    assert.equal(server.messages.length, 1);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 33, result: { called: "aws.s3.bucket.delete" } },
    ]);
    const ledger = await readLedgerDecisions(harness.ledgerDir, "test-http");
    assert.ok(ledger.includes("hold"));
    assert.ok(ledger.includes("hold:approved"));
  });

  test("http transport deny answers locally", async () => {
    const server = await startHttpUpstream();
    const harness = await makeHttpHarness(server, "deny");
    const run = harness.start();

    harness.input.push(JSON.stringify(toolCall(34, "aws.s3.bucket.delete")));
    await waitFor(() => harness.outputMessages.length === 1, "http deny response");
    harness.input.close();
    await run;
    await server.close();

    assert.deepEqual(server.messages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string } };
    assert.equal(error.id, 34);
    assert.match(error.error.message, /denied/);
  });

  test("stdio transport warns when upstreamUrl is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-proxy-"));
    const policyPath = join(dir, "policy.yml");
    await writeFile(policyPath, policyText("allow"));
    const errors: string[] = [];

    await runProxy({
      upstreamCommand: ["fake"],
      upstreamUrl: "http://127.0.0.1:1/mcp",
      policyPath,
      posture: "fail-closed",
      ledgerDir: await mkdtemp(join(tmpdir(), "void-bin-test-")),
      input: fromLines([]),
      output() {},
      error(line) { errors.push(line); },
      upstreamSpawn(events) { return fakeUpstream(events, []); },
    });

    assert.match(errors.join("\n"), /upstreamUrl is ignored for stdio transport/);
  });

  test("http transport without upstreamUrl throws a startup error", async () => {
    await assert.rejects(
      () => runProxy({
        transport: "http",
        policyPath: "unused.yml",
        posture: "observe",
        input: fromLines([]),
        output() {},
        error() {},
      }),
      ProxyStartupError,
    );
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
  // The hold lands after awaited ledger appends (real fs in a temp dir),
  // so a fixed tick count races disk latency. Poll on wall time instead:
  // the queue either appears within the hold's own lifetime or the test
  // genuinely failed.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const queue = getQueue();
    if (queue !== null && queue.list().length > 0) return queue;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("queue was not populated");
}


type HttpHarness = {
  readonly input: LineQueue;
  readonly outputMessages: unknown[];
  readonly errors: string[];
  readonly ledgerDir: string;
  onHold?: (queue: HoldQueue) => void;
  readonly start: () => Promise<void>;
};

type HttpUpstreamHarness = {
  readonly url: string;
  readonly messages: Array<Record<string, unknown>>;
  readonly close: () => Promise<void>;
};

type LineQueue = AsyncIterable<string> & {
  readonly push: (line: string) => void;
  readonly close: () => void;
};

async function makeHttpHarness(server: HttpUpstreamHarness, decision: Decision): Promise<HttpHarness> {
  const dir = await mkdtemp(join(tmpdir(), "void-proxy-"));
  const policyPath = join(dir, "policy.yml");
  await writeFile(policyPath, policyText(decision));
  const input = lineQueue();
  const outputMessages: unknown[] = [];
  const errors: string[] = [];
  const ledgerDir = await mkdtemp(join(tmpdir(), "void-bin-http-test-"));
  const harness: HttpHarness = {
    input,
    outputMessages,
    errors,
    ledgerDir,
    start() {
      return runProxy({
        transport: "http",
        upstreamUrl: server.url,
        policyPath,
        posture: "fail-closed",
        ledgerDir,
        workspace: "test-http",
        input,
        output(line) { outputMessages.push(JSON.parse(line) as unknown); },
        error(line) { errors.push(line); },
        onHold: (queue) => harness.onHold?.(queue),
      });
    },
  };
  return harness;
}

async function startHttpUpstream(): Promise<HttpUpstreamHarness> {
  const messages: Array<Record<string, unknown>> = [];
  const streams = new Set<ServerResponse>();
  const server: Server = createServer((request, response) => {
    void handleHttpUpstreamRequest(request, response, messages, streams);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    messages,
    async close() {
      for (const stream of streams) {
        stream.end();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function handleHttpUpstreamRequest(
  request: IncomingMessage,
  response: ServerResponse,
  messages: Array<Record<string, unknown>>,
  streams: Set<ServerResponse>,
): Promise<void> {
  if (request.method === "GET") {
    streams.add(response);
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    request.on("close", () => { streams.delete(response); });
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "GET, POST" });
    response.end();
    return;
  }

  const message = JSON.parse(await requestText(request)) as { readonly id?: number; readonly method?: string; readonly params?: { readonly name?: string } };
  messages.push(message as Record<string, unknown>);
  response.writeHead(200, { "content-type": "application/json" });
  if (message.method === "initialize") {
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake-http", version: "1" } },
    }));
    return;
  }
  if (message.method === "tools/call") {
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { called: message.params?.name } }));
    return;
  }
  response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
}

async function requestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function lineQueue(): LineQueue {
  const values: string[] = [];
  const waiters: Array<(result: IteratorResult<string>) => void> = [];
  let closed = false;

  const finish = (): void => {
    while (waiters.length > 0) {
      waiters.shift()?.({ done: true, value: undefined });
    }
  };

  const next = async (): Promise<IteratorResult<string>> => {
    const value = values.shift();
    if (value !== undefined) return { done: false, value };
    if (closed) return { done: true, value: undefined };
    return new Promise<IteratorResult<string>>((resolve) => { waiters.push(resolve); });
  };

  return {
    push(line) {
      if (closed) throw new Error("input queue is closed");
      const waiter = waiters.shift();
      if (waiter === undefined) {
        values.push(line);
        return;
      }
      waiter({ done: false, value: line });
    },
    close() {
      closed = true;
      finish();
    },
    [Symbol.asyncIterator]() {
      return {
        next,
        async return() {
          closed = true;
          finish();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function readLedgerDecisions(ledgerDir: string, workspace: string): Promise<string[]> {
  const text = await readFile(join(ledgerDir, `${workspace}.jsonl`), "utf8");
  return text.split("\n").filter((line) => line !== "").map((line) => {
    const entry = JSON.parse(line) as { readonly body: { readonly decision: string } };
    return entry.body.decision;
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}
