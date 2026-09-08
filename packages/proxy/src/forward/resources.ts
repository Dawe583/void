import type { JsonRpcRequest } from "../rpc.ts";

type IncomingMessage = Record<string, unknown>;

export type ForwardCallback<T extends IncomingMessage = JsonRpcRequest> = (message: T) => Promise<unknown> | unknown;

const RESOURCE_METHODS = new Set(["resources/list", "resources/read", "resources/subscribe", "resources/unsubscribe"]);
const RESOURCE_NOTIFICATION = "notifications/resources/list_changed";

export async function forwardResourceMessage<T extends IncomingMessage>(message: T, forward: ForwardCallback<T>): Promise<unknown> {
  validateResourceRequest(message);
  return forward(message);
}

export function relayResourceNotification<T extends IncomingMessage>(message: T): T {
  if (!isObject(message) || message.jsonrpc !== "2.0" || message.method !== RESOURCE_NOTIFICATION) {
    throw new TypeError("expected a resource notification");
  }
  if ("id" in message) throw new TypeError("resource notification must not carry id");
  if (message.params !== undefined && !isObject(message.params)) throw new TypeError("params must be an object when present");
  return message;
}

function validateResourceRequest(message: IncomingMessage): asserts message is JsonRpcRequest {
  if (!isObject(message)) throw new TypeError("request must be an object");
  if (message.jsonrpc !== "2.0") throw new TypeError("jsonrpc must be 2.0");
  if (!("id" in message)) throw new TypeError("id is required");
  if (typeof message.method !== "string" || !RESOURCE_METHODS.has(message.method)) throw new TypeError("method is not a resource request");
  if (message.params !== undefined && !isObject(message.params)) throw new TypeError("params must be an object when present");
  if (message.method === "resources/read") requireStringParam(message.params, "uri");
  if (message.method === "resources/subscribe") requireStringParam(message.params, "uri");
  if (message.method === "resources/unsubscribe") requireStringParam(message.params, "uri");
}

function requireStringParam(params: unknown, name: string): void {
  if (!isObject(params) || typeof params[name] !== "string" || params[name] === "") throw new TypeError(`params.${name} is required`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
