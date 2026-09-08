import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { Session } from "./session.ts";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResult } from "./rpc.ts";

describe("Session", () => {
  test("remaps request ids out and results back", () => {
    const session = new Session();
    const outbound = session.translateRequestOut(request(10, "tools/list"));

    assert.equal(outbound.id, 1);
    assert.deepEqual([...session.maps.agentToUpstream.entries()], [[10, 1]]);

    const inbound = session.translateInbound({ jsonrpc: "2.0", id: 1, result: { tools: [] } });

    assert.deepEqual(inbound, { jsonrpc: "2.0", id: 10, result: { tools: [] } });
  });

  test("remaps progress tokens to the same id mapping", () => {
    const session = new Session();
    const outbound = session.translateRequestOut({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "db.query", _meta: { progressToken: 7 } },
    });

    assert.equal(outbound.id, 1);
    assert.deepEqual(outbound.params, { name: "db.query", _meta: { progressToken: 1 } });

    const progress = session.translateInbound({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 1, progress: 0.5 },
    });

    assert.deepEqual(progress, {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 7, progress: 0.5 },
    });
  });

  test("drops inbound messages that reference unknown ids", () => {
    const session = new Session();

    assert.equal(session.translateInbound({ jsonrpc: "2.0", id: 99, result: {} }), null);
    assert.equal(session.translateInbound({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 99, progress: 1 },
    }), null);
  });

  test("negotiates only versions the agent can accept", () => {
    const session = new Session();

    assert.equal(session.negotiatedVersion("2025-06-18", "2025-06-18"), "2025-06-18");
    assert.equal(session.negotiatedVersion("2025-03-26", "2025-11-25"), "2025-03-26");
    assert.equal(session.negotiatedVersion("2024-11-05", "2024-11-05"), "2024-11-05");
    assert.equal(session.negotiatedVersion("2099-01-01", "2099-01-01"), "2025-11-25");
  });

  test("drop removes a mapping so late results are ignored", () => {
    const session = new Session();
    const outbound = session.translateRequestOut(request(5, "tools/list"));

    session.drop(5);

    assert.deepEqual([...session.maps.agentToUpstream.entries()], []);
    assert.equal(session.translateInbound({ jsonrpc: "2.0", id: outbound.id, result: {} }), null);
  });

  test("translates cancellation and removes the mapping", () => {
    const session = new Session();
    session.translateRequestOut(request(4, "tools/call"));

    const cancel = session.translateCancellation(4);

    assert.deepEqual(cancel, {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });
    assert.equal(session.translateCancellation(4), null);
  });

  test("uses one id stream across client and server side maps", () => {
    const session = new Session();
    session.translateRequestOut(request(1, "tools/list"));

    const serverRequest = session.translateInbound(request(2, "roots/list"));

    assert.deepEqual([...session.maps.agentToUpstream.entries()], [[1, 2]]);
    assert.deepEqual([...session.maps.upstreamToAgent.entries()], [[2, 3]]);
    assert.deepEqual(serverRequest, { jsonrpc: "2.0", id: 3, method: "roots/list" });
  });

  test("allocateAgentId never reuses ids", () => {
    const session = new Session();

    assert.equal(session.allocateAgentId(), 1);
    assert.equal(session.allocateAgentId(), 2);
    session.drop(1);
    assert.equal(session.allocateAgentId(), 3);
  });
});

function request(id: number, method: string): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method };
}
