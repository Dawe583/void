import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { HttpUpstreamError, upstreamHttp } from "./http.ts";

type RequestRecord = {
  readonly method: string;
  readonly accept: string | undefined;
  readonly session: string | undefined;
  readonly lastEventId: string | undefined;
  readonly body: string;
};

async function listen(server: Server): Promise<URL> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  for (;;) {
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function writeJson(response: ServerResponse, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(200, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

describe("upstreamHttp", () => {
  test("captures the initialize session id and resends it on POST", async () => {
    const records: RequestRecord[] = [];
    const server = createServer(async (request, response) => {
      const body = request.method === "POST" ? await readBody(request) : "";
      records.push({
        method: request.method ?? "",
        accept: request.headers.accept,
        session: headerValue(request.headers["mcp-session-id"]),
        lastEventId: headerValue(request.headers["last-event-id"]),
        body,
      });
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end();
        return;
      }
      const parsed = JSON.parse(body) as { readonly id: number; readonly method: string };
      if (parsed.method === "initialize") {
        writeJson(response, { jsonrpc: "2.0", id: parsed.id, result: { protocolVersion: "2025-11-25" } }, { "mcp-session-id": "sid-1" });
        return;
      }
      writeJson(response, { jsonrpc: "2.0", id: parsed.id, result: { ok: true } });
    });
    const url = await listen(server);
    const messages: string[] = [];
    const upstream = upstreamHttp(url, { events: { onMessage: (line) => messages.push(line), onClose() {}, onError(error) { throw error; } }, reconnectDelayMs: 1000 });

    try {
      upstream.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }));
      await waitFor(() => messages.length === 1);
      upstream.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
      await waitFor(() => messages.length === 2);

      const posts = records.filter((record) => record.method === "POST");
      assert.equal(posts[0]?.accept, "application/json, text/event-stream");
      assert.equal(posts[1]?.session, "sid-1");
    } finally {
      upstream.close();
      await closeServer(server);
    }
  });

  test("frames a POST SSE answer one message per line", async () => {
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end();
        return;
      }
      await readBody(request);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"jsonrpc":"2.0","id":7,"result":{"done":true}}\n\n');
      response.write('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":7,"progress":1}}\n\n');
      response.end();
    });
    const url = await listen(server);
    const messages: string[] = [];
    const upstream = upstreamHttp(url, { events: { onMessage: (line) => messages.push(line), onClose() {}, onError(error) { throw error; } }, reconnectDelayMs: 1000 });

    try {
      upstream.send(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "x" } }));
      await waitFor(() => messages.length === 2);

      assert.deepEqual(messages, [
        '{"jsonrpc":"2.0","id":7,"result":{"done":true}}',
        '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":7,"progress":1}}',
      ]);
    } finally {
      upstream.close();
      await closeServer(server);
    }
  });

  test("reports an oversized response as HttpUpstreamError", async () => {
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end();
        return;
      }
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("abcdef");
    });
    const url = await listen(server);
    const errors: Error[] = [];
    const upstream = upstreamHttp(url, { maxBufferSize: 5, events: { onMessage() {}, onClose() {}, onError(error) { errors.push(error); } }, reconnectDelayMs: 1000 });

    try {
      upstream.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
      await waitFor(() => errors.length === 1);

      assert.ok(errors[0] instanceof HttpUpstreamError);
      assert.equal((errors[0] as HttpUpstreamError).status, 200);
      assert.match(errors[0]?.message ?? "", /exceeded 5 bytes/);
    } finally {
      upstream.close();
      await closeServer(server);
    }
  });

  test("reconnects a dropped GET stream without replay headers", async () => {
    const getRecords: RequestRecord[] = [];
    const timers: Array<() => void> = [];
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        getRecords.push({
          method: "GET",
          accept: request.headers.accept,
          session: headerValue(request.headers["mcp-session-id"]),
          lastEventId: headerValue(request.headers["last-event-id"]),
          body: "",
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":1,"progress":1}}\n\n');
        response.end();
        return;
      }
      response.writeHead(202);
      response.end();
    });
    const url = await listen(server);
    const messages: string[] = [];
    const upstream = upstreamHttp(url, {
      events: { onMessage: (line) => messages.push(line), onClose() {}, onError(error) { throw error; } },
      reconnectDelayMs: 25,
      clock: {
        setTimeout(callback) {
          timers.push(callback);
          return timers.length;
        },
        clearTimeout() {},
      },
    });

    try {
      await waitFor(() => getRecords.length === 1 && timers.length === 1);
      timers[0]?.();
      await waitFor(() => getRecords.length === 2);

      assert.equal(getRecords[0]?.accept, "text/event-stream");
      assert.equal(getRecords[1]?.lastEventId, undefined);
      assert.equal(messages.length, 2);
    } finally {
      upstream.close();
      await closeServer(server);
    }
  });
});

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}
