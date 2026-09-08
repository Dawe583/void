import type { JsonRpcRequest } from "../rpc.ts";

type IncomingMessage = Record<string, unknown>;

export type ForwardCallback<T extends IncomingMessage = JsonRpcRequest> = (message: T) => Promise<unknown> | unknown;

const PROMPT_METHODS = new Set(["prompts/list", "prompts/get"]);
const PROMPT_NOTIFICATION = "notifications/prompts/list_changed";

export async function forwardPromptMessage<T extends IncomingMessage>(message: T, forward: ForwardCallback<T>): Promise<unknown> {
  validatePromptRequest(message);
  return forward(message);
}

export function relayPromptNotification<T extends IncomingMessage>(message: T): T {
  if (!isObject(message) || message.jsonrpc !== "2.0" || message.method !== PROMPT_NOTIFICATION) {
    throw new TypeError("expected a prompt notification");
  }
  if ("id" in message) throw new TypeError("prompt notification must not carry id");
  if (message.params !== undefined && !isObject(message.params)) throw new TypeError("params must be an object when present");
  return message;
}

function validatePromptRequest(message: IncomingMessage): asserts message is JsonRpcRequest {
  if (!isObject(message)) throw new TypeError("request must be an object");
  if (message.jsonrpc !== "2.0") throw new TypeError("jsonrpc must be 2.0");
  if (!("id" in message)) throw new TypeError("id is required");
  if (typeof message.method !== "string" || !PROMPT_METHODS.has(message.method)) throw new TypeError("method is not a prompt request");
  if (message.params !== undefined && !isObject(message.params)) throw new TypeError("params must be an object when present");
  if (message.method === "prompts/get") requireStringParam(message.params, "name");
}

function requireStringParam(params: unknown, name: string): void {
  if (!isObject(params) || typeof params[name] !== "string" || params[name] === "") throw new TypeError(`params.${name} is required`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
