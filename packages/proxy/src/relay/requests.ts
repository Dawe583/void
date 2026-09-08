type JsonRpcId = string | number;

type JsonObject = { readonly [key: string]: unknown };

// JsonRpcRequest lives in rpc.ts so every module speaks the same shape.
import type { JsonRpcRequest } from "../rpc.ts";
export type { JsonRpcRequest };

export type JsonRpcSuccessResponse = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly result: unknown;
};

export type JsonRpcErrorResponse = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type ServerRequestRelaySession = {
  readonly upstreamToAgent?: Map<JsonRpcId, JsonRpcId> | ReadonlyMap<JsonRpcId, JsonRpcId>;
  readonly allocateAgentId: () => JsonRpcId;
  readonly recordServerRequest?: (upstreamId: JsonRpcId, agentId: JsonRpcId) => void;
};

function setMapValue(map: Map<JsonRpcId, JsonRpcId> | ReadonlyMap<JsonRpcId, JsonRpcId> | undefined, key: JsonRpcId, value: JsonRpcId): void {
  if (map instanceof Map) {
    map.set(key, value);
  }
}

function lookupReverse(map: ReadonlyMap<JsonRpcId, JsonRpcId> | undefined, value: JsonRpcId): JsonRpcId | undefined {
  if (map === undefined) {
    return undefined;
  }

  for (const [candidate, mapped] of map.entries()) {
    if (Object.is(mapped, value)) {
      return candidate;
    }
  }

  return undefined;
}

export function relayServerRequest(
  request: JsonRpcRequest,
  session: ServerRequestRelaySession,
): JsonRpcRequest {
  const agentId = session.allocateAgentId();
  session.recordServerRequest?.(request.id, agentId);
  setMapValue(session.upstreamToAgent, request.id, agentId);

  return request.params === undefined
    ? { ...request, id: agentId }
    : { ...request, id: agentId, params: { ...request.params } };
}

export function relayServerResponse(
  agentResponse: JsonRpcResponse,
  session: ServerRequestRelaySession,
): JsonRpcResponse {
  const upstreamId = agentResponse.id === null
    ? undefined
    : lookupReverse(session.upstreamToAgent, agentResponse.id);
  const id = upstreamId ?? agentResponse.id;

  if ("error" in agentResponse) {
    return { ...agentResponse, id, error: { ...agentResponse.error } };
  }

  return { ...agentResponse, id };
}
