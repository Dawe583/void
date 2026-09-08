import type { JsonRpcMessage } from "./rpc.ts";

export const DEFAULT_INBOUND_MAX_BYTES = 10 * 1024 * 1024;

export class JsonRpcInputError extends Error {
  readonly kind: "parse" | "invalid";

  constructor(kind: "parse" | "invalid", message: string) {
    super(message);
    this.name = "JsonRpcInputError";
    this.kind = kind;
  }
}

export function assertInboundLineCeiling(
  line: string,
  maxBytes = DEFAULT_INBOUND_MAX_BYTES,
): void {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("inbound message ceiling must be a positive integer");
  }
  const size = Buffer.byteLength(line, "utf8");
  if (size > maxBytes) {
    throw new JsonRpcInputError("invalid", `inbound message exceeded ${maxBytes} bytes`);
  }
}

export function assertSingleJsonRpcMessage(value: unknown): asserts value is JsonRpcMessage {
  if (Array.isArray(value)) {
    throw new JsonRpcInputError("invalid", "JSON-RPC batch requests are not supported");
  }
  if (!isObject(value) || value.jsonrpc !== "2.0") {
    throw new JsonRpcInputError("invalid", "message must be a JSON-RPC 2.0 object");
  }
  const hasMethod = "method" in value;
  const hasId = "id" in value;
  const hasResult = "result" in value;
  const hasError = "error" in value;
  if (hasId) {
    assertRequestId(value.id);
  }
  if (hasMethod) {
    if (typeof value.method !== "string" || value.method === "") {
      throw new JsonRpcInputError("invalid", "JSON-RPC method must be a non-empty string");
    }
    return;
  }
  if (hasResult === hasError) {
    throw new JsonRpcInputError("invalid", "JSON-RPC response must carry exactly one result or error");
  }
}

function assertRequestId(value: unknown): asserts value is string | number {
  if (value === null) {
    throw new JsonRpcInputError("invalid", "JSON-RPC id null is not accepted by MCP");
  }
  if (typeof value === "string" && value !== "") {
    return;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return;
  }
  throw new JsonRpcInputError("invalid", "JSON-RPC id must be a string or integer");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
