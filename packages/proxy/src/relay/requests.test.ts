import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { relayServerRequest, relayServerResponse } from "./requests.ts";
import type { JsonRpcRequest, ServerRequestRelaySession } from "./requests.ts";

describe("relayServerRequest", () => {
  test("server request gets a fresh agent id and records the map", () => {
    const upstreamToAgent = new Map<string | number, string | number>();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 42,
      method: "sampling/createMessage",
      params: { maxTokens: 10, messages: [] },
    };
    const session: ServerRequestRelaySession = { upstreamToAgent, allocateAgentId: () => 7 };

    const relayed = relayServerRequest(request, session);

    assert.deepEqual(relayed, { jsonrpc: "2.0", id: 7, method: "sampling/createMessage", params: { maxTokens: 10, messages: [] } });
    assert.deepEqual([...upstreamToAgent.entries()], [[42, 7]]);
    assert.deepEqual(request, { jsonrpc: "2.0", id: 42, method: "sampling/createMessage", params: { maxTokens: 10, messages: [] } });
    assert.notEqual(relayed, request);
    assert.notEqual(relayed.params, request.params);
  });

  test("relays all WP-01 server-to-client request methods without params changes", () => {
    const requests: readonly JsonRpcRequest[] = [
      { jsonrpc: "2.0", id: 1, method: "sampling/createMessage", params: { maxTokens: 1, messages: [] } },
      { jsonrpc: "2.0", id: 2, method: "roots/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
      { jsonrpc: "2.0", id: 4, method: "completion/complete", params: { ref: { type: "ref/prompt", name: "p" }, argument: { name: "a", value: "b" } } },
      { jsonrpc: "2.0", id: 5, method: "elicitation/create", params: { message: "Approve?", requestedSchema: { type: "object", properties: {} } } },
    ];
    let nextId = 100;
    const session: ServerRequestRelaySession = { upstreamToAgent: new Map(), allocateAgentId: () => nextId++ };

    const relayed = requests.map((request) => relayServerRequest(request, session));

    assert.deepEqual(relayed.map((request) => request.id), [100, 101, 102, 103, 104]);
    assert.deepEqual(relayed.map((request) => request.method), requests.map((request) => request.method));
    assert.deepEqual(relayed.map((request) => request.params), requests.map((request) => request.params));
  });
});

describe("relayServerResponse", () => {
  test("maps agent success response back to the upstream id", () => {
    const session: ServerRequestRelaySession = {
      upstreamToAgent: new Map<string | number, string | number>([[42, 7]]),
      allocateAgentId: () => 0,
    };

    const relayed = relayServerResponse({ jsonrpc: "2.0", id: 7, result: { roots: [] } }, session);

    assert.deepEqual(relayed, { jsonrpc: "2.0", id: 42, result: { roots: [] } });
  });

  test("maps agent error response back to the upstream id", () => {
    const session: ServerRequestRelaySession = {
      upstreamToAgent: new Map<string | number, string | number>([[42, 7]]),
      allocateAgentId: () => 0,
    };

    const relayed = relayServerResponse({ jsonrpc: "2.0", id: 7, error: { code: -32603, message: "failed", data: { retry: false } } }, session);

    assert.deepEqual(relayed, { jsonrpc: "2.0", id: 42, error: { code: -32603, message: "failed", data: { retry: false } } });
  });

  test("keeps both-direction id collisions separate", () => {
    const upstreamToAgent = new Map<string | number, string | number>([[5, 6]]);
    const session: ServerRequestRelaySession = { upstreamToAgent, allocateAgentId: () => 6 };
    const request: JsonRpcRequest = { jsonrpc: "2.0", id: 5, method: "roots/list" };

    const relayedRequest = relayServerRequest(request, session);
    const relayedResponse = relayServerResponse({ jsonrpc: "2.0", id: 6, result: { roots: [] } }, session);

    assert.equal(relayedRequest.id, 6);
    assert.deepEqual(relayedResponse, { jsonrpc: "2.0", id: 5, result: { roots: [] } });
  });
});
