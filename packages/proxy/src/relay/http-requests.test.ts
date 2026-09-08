import { createServer } from "node:http";
import type { Server } from "node:http";
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { createHttpRequestRelay } from "./http-requests.ts";
import type { HttpRequestRelay } from "./http-requests.ts";
import type { UpstreamProcess } from "../transport/stdio.ts";

type SentMessage = {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
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

function fakeUpstream(sent: SentMessage[]): UpstreamProcess {
  return {
    send(line: string): void {
      sent.push(JSON.parse(line) as SentMessage);
    },
    close() {},
    onStderr() {
      return () => {};
    },
  };
}

async function withRelay(testBody: (url: URL, relay: HttpRequestRelay, sent: SentMessage[]) => Promise<void>): Promise<void> {
  const sent: SentMessage[] = [];
  const relay = createHttpRequestRelay({ upstream: fakeUpstream(sent) });
  const server = createServer((request, response) => {
    void relay.handle(request, response);
  });
  const url = await listen(server);
  try {
    await testBody(url, relay, sent);
  } finally {
    relay.close();
    await closeServer(server);
  }
}

describe("createHttpRequestRelay", () => {
  test("answers each id in a batched client request", async () => {
    await withRelay(async (url, relay, sent) => {
      const responsePromise = fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "a" } },
          { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "b" } },
        ]),
      });

      await waitFor(() => sent.length === 2);
      relay.receiveUpstreamLine(JSON.stringify({ jsonrpc: "2.0", id: sent[1]?.id, result: { second: true } }));
      relay.receiveUpstreamLine(JSON.stringify({ jsonrpc: "2.0", id: sent[0]?.id, result: { first: true } }));
      const response = await responsePromise;
      const body = await response.json() as unknown;

      assert.equal(response.status, 200);
      assert.deepEqual(body, [
        { jsonrpc: "2.0", id: 3, result: { second: true } },
        { jsonrpc: "2.0", id: 1, result: { first: true } },
      ]);
    });
  });

  test("streams progress and result over SSE while a request is in flight", async () => {
    await withRelay(async (url, relay, sent) => {
      const responsePromise = fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "slow", _meta: { progressToken: 11 } } }),
      });

      await waitFor(() => sent.length === 1);
      const upstreamId = sent[0]?.id;
      relay.receiveUpstreamLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: upstreamId, progress: 0.5 } }));
      relay.receiveUpstreamLine(JSON.stringify({ jsonrpc: "2.0", id: upstreamId, result: { done: true } }));
      const response = await responsePromise;
      const text = await response.text();

      assert.equal(response.headers.get("content-type"), "text/event-stream");
      assert.match(text, /"method":"notifications\/progress"/);
      assert.match(text, /"progressToken":11/);
      assert.match(text, /"id":11/);
      assert.match(text, /"done":true/);
    });
  });

  test("routes cancellation upstream and drops the in-flight mapping", async () => {
    await withRelay(async (url, relay, sent) => {
      const responsePromise = fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "slow" } }),
      });

      await waitFor(() => sent.length === 1);
      const upstreamId = sent[0]?.id;
      const cancel = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 5, reason: "client" } }),
      });
      const response = await responsePromise;
      const text = await response.text();

      assert.equal(cancel.status, 202);
      assert.deepEqual(sent[1], { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: upstreamId } });
      assert.equal(relay.session.maps.agentToUpstream.has(5), false);
      assert.match(text, /"method":"notifications\/cancelled"/);
    });
  });

  test("rejects an oversized client body before routing upstream", async () => {
    const sent: SentMessage[] = [];
    const relay = createHttpRequestRelay({ upstream: fakeUpstream(sent), maxBodySize: 5 });
    const server = createServer((request, response) => {
      void relay.handle(request, response);
    });
    const url = await listen(server);

    try {
      const response = await fetch(url, { method: "POST", body: "abcdef" });
      const body = await response.json() as { readonly error: { readonly code: number; readonly message: string } };

      assert.equal(response.status, 413);
      assert.equal(body.error.code, -32700);
      assert.match(body.error.message, /exceeded 5 bytes/);
      assert.deepEqual(sent, []);
    } finally {
      relay.close();
      await closeServer(server);
    }
  });
});
