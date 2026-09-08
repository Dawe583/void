export type JsonRpcId = string | number;

export type JsonObject = Readonly<Record<string, unknown>>;

export type JsonRpcRequest = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: JsonObject;
};

export type JsonRpcNotification = {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: JsonObject;
};

export type JsonRpcResult = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
};

export type JsonRpcErrorBody = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

export type JsonRpcError = {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly error: JsonRpcErrorBody;
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResult
  | JsonRpcError;
