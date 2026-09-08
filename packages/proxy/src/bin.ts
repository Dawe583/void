import { createInterface } from "node:readline";
import process from "node:process";
import { readFile } from "node:fs/promises";

import { classifyTool, loadFacts, toEvaluationContext, validateFactsFile } from "../../registry/src/index.ts";
import type { FactsFile, FactsReport } from "../../registry/src/index.ts";
import { decide, HoldQueue, loadPolicy } from "../../policy/src/index.ts";
import type { LoadedPolicy, PolicyCall, PolicyDecision } from "../../policy/src/index.ts";

import { forwardPromptMessage } from "./forward/prompts.ts";
import { forwardResourceMessage } from "./forward/resources.ts";
import { interceptCall } from "./forward/tools.ts";
import type { InterceptedCall, JsonRpcError, JsonRpcResult } from "./forward/tools.ts";
import type { JsonObject, JsonRpcErrorBody, JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest } from "./rpc.ts";
import { relayNotification } from "./relay/notifications.ts";
import { relayServerRequest, relayServerResponse } from "./relay/requests.ts";
import type { JsonRpcResponse } from "./relay/requests.ts";
import { Session } from "./session.ts";
import { spawnUpstream } from "./transport/stdio.ts";
import type { UpstreamProcess } from "./transport/stdio.ts";

export type ProxyPosture = "fail-closed" | "observe" | "observe-only";

export type UpstreamEvents = {
  readonly onMessage: (line: string) => void;
  readonly onClose: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onError: (error: Error) => void;
};

export type ProxyOptions = {
  readonly upstreamCommand: readonly string[];
  readonly upstreamEnv?: Record<string, string>;
  readonly policyPath: string;
  readonly factsPath?: string;
  readonly posture: ProxyPosture;
  readonly onHold?: (queue: HoldQueue) => void;
  readonly upstreamSpawn?: (events: UpstreamEvents) => UpstreamProcess;
  readonly input?: AsyncIterable<string>;
  readonly output?: (line: string) => void;
  readonly error?: (line: string) => void;
};

type InitializeRequest = {
  readonly agentId: JsonRpcId;
  readonly requestedVersion: string;
};

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

export async function runProxy(options: ProxyOptions): Promise<void> {
  const write = options.output ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const writeError = options.error ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  let policy: LoadedPolicy;
  let facts: FactsReport;
  try {
    policy = await readPolicy(options.policyPath);
    facts = await readFacts(options.factsPath);
  } catch (error) {
    writeError(`startup failed: ${errorMessage(error)}`);
    throw error;
  }
  const session = new Session();
  const queue = new HoldQueue();
  options.onHold?.(queue);
  let resolveUpstreamClosed: () => void = () => {};
  const upstreamClosed = new Promise<void>((resolve) => { resolveUpstreamClosed = resolve; });

  const initializeByUpstream = new Map<JsonRpcId, InitializeRequest>();
  let upstream: UpstreamProcess;

  const sendJson = (message: unknown): void => {
    write(JSON.stringify(message));
  };
  const sendUpstream = (message: unknown): void => {
    upstream.send(JSON.stringify(message));
  };

  const forwardAfterTranslate = (request: JsonRpcRequest): JsonRpcRequest => {
    const translated = session.translateRequestOut(request);
    sendUpstream(translated);
    return translated;
  };

  const handleUpstreamLine = (line: string): void => {
    let message: JsonRpcMessage;
    try {
      message = parseMessage(line);
    } catch (error) {
      writeError(`upstream sent malformed JSON: ${errorMessage(error)}`);
      return;
    }

    if (isRequest(message)) {
      sendJson(relayServerRequest(message, session));
      return;
    }

    if (isNotification(message)) {
      const relayed = relayNotification(message, session.maps).notification;
      sendJson(relayed);
      return;
    }

    if (isResponse(message) && message.id !== undefined && initializeByUpstream.has(message.id)) {
      const init = initializeByUpstream.get(message.id)!;
      initializeByUpstream.delete(message.id);
      const translated = session.translateInbound(message);
      if (translated !== null) sendJson(rewriteInitializeResult(translated, session, init));
      return;
    }

    const translated = session.translateInbound(message);
    if (translated !== null) sendJson(translated);
  };

  const handleUpstreamClose = (): void => {
    queue.close();
    resolveUpstreamClosed();
  };

  try {
    upstream = options.upstreamSpawn === undefined
      ? spawnUpstream(options.upstreamCommand, options.upstreamEnv ?? cleanEnv(process.env), {
          events: {
            onMessage: handleUpstreamLine,
            onClose: handleUpstreamClose,
            onError(error) { writeError(`upstream error: ${error.message}`); },
          },
        })
      : options.upstreamSpawn({
          onMessage: handleUpstreamLine,
          onClose: handleUpstreamClose,
          onError(error) { writeError(`upstream error: ${error.message}`); },
        });
  } catch (error) {
    throw new UpstreamStartError(errorMessage(error));
  }

  const handleAgentLine = async (line: string): Promise<void> => {
    let message: JsonRpcMessage;
    try {
      message = parseMessage(line);
    } catch (error) {
      sendJson(jsonRpcError(null, PARSE_ERROR, `Parse error: ${errorMessage(error)}`));
      return;
    }

    const responseId = "id" in message && message.id !== undefined ? message.id : null;
    try {
      if (isRequest(message)) {
        if (message.method === "initialize") {
          const translated = session.translateRequestOut(message);
          initializeByUpstream.set(translated.id, {
            agentId: message.id,
            requestedVersion: readProtocolVersion(message.params),
          });
          sendUpstream(translated);
          return;
        }

        if (message.method === "tools/call") {
          await handleToolCall(message, policy, facts, queue, forwardAfterTranslate, sendJson, writeError, normalizePosture(options.posture));
          return;
        }

        if (isResourceMethod(message.method)) {
          await forwardResourceMessage(message, async (request) => forwardAfterTranslate(request));
          return;
        }

        if (isPromptMethod(message.method)) {
          await forwardPromptMessage(message, async (request) => forwardAfterTranslate(request));
          return;
        }

        forwardAfterTranslate(message);
        return;
      }

      if (isNotification(message)) {
        const cancel = cancellationFromAgent(message, session);
        if (cancel !== null) {
          sendUpstream(cancel);
          return;
        }
        sendUpstream(relayNotification(message, session.maps).notification);
        return;
      }

      sendUpstream(relayServerResponse(message as JsonRpcResponse, session));
    } catch (error) {
      sendJson(jsonRpcError(responseId, INTERNAL_ERROR, errorMessage(error)));
    }
  };

  const input = (options.input ?? stdinLines())[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await Promise.race([
        input.next(),
        upstreamClosed.then(() => ({ done: true, value: undefined } as IteratorResult<string>)),
      ]);
      if (next.done === true) break;
      await handleAgentLine(next.value);
    }
  } finally {
    await input.return?.();
    upstream.close();
    queue.close();
  }
}

export class PolicyStartupError extends Error {}
export class UpstreamStartError extends Error {}

async function readPolicy(path: string): Promise<LoadedPolicy> {
  const text = await readFile(path, "utf8");
  const loaded = loadPolicy(text);
  if (!loaded.ok) throw new PolicyStartupError(loaded.errors.join("; "));
  return loaded;
}

async function readFacts(path: string | undefined): Promise<FactsReport> {
  if (path === undefined) return loadFacts({ facts: {} }, new Date());
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const errors = validateFactsFile(raw);
  if (errors.length > 0) throw new PolicyStartupError(errors.join("; "));
  return loadFacts(raw as FactsFile, new Date());
}

async function handleToolCall(
  request: JsonRpcRequest,
  policy: LoadedPolicy,
  facts: FactsReport,
  queue: HoldQueue,
  forward: (request: JsonRpcRequest) => JsonRpcRequest,
  sendJson: (message: unknown) => void,
  writeError: (line: string) => void,
  posture: "fail-closed" | "observe",
): Promise<void> {
  const call = interceptedCall(request);
  let lastPolicyCall: PolicyCall | null = null;
  let lastDecision: PolicyDecision | null = null;
  const policyFn = (policyCall: PolicyCall): PolicyDecision => {
    lastPolicyCall = policyCall;
    const decision = decide(policy, policyCall);
    lastDecision = decision;
    if (posture === "observe" && decision.kind !== "allow") {
      writeError(`observe: ${decision.kind} verdict for ${policyCall.tool} forwarded`);
      return { kind: "allow" };
    }
    return decision;
  };

  const verdict = interceptCall(call, {
    classify: () => classifyTool(call.tool, toEvaluationContext(facts, call.args)),
    policy: policyFn,
    hold: (seconds) => {
      const decision = lastDecision;
      const policyCall = lastPolicyCall;
      if (decision === null || decision.kind !== "hold" || policyCall === null) throw new Error("hold decision state missing");
      return queue.hold({
        tool: call.tool,
        klass: policyCall.klass,
        blastRadius: policyCall.blastRadius,
        ruleIndex: decision.ruleIndex,
        rationale: decision.rationale,
        args: call.args,
        notify: decision.notify,
      }, seconds);
    },
    ledger: () => {},
  });

  if (verdict.kind === "allow") {
    forward(request);
    return;
  }

  if (verdict.kind === "deny") {
    sendJson({ ...verdict.error, id: request.id });
    return;
  }

  const held = await verdict.promise;
  if ("error" in held) {
    sendJson({ ...held, id: request.id });
    return;
  }
  forward(request);
}

function interceptedCall(request: JsonRpcRequest): InterceptedCall {
  const params = request.params ?? {};
  const name = params.name;
  const args = params.arguments;
  if (typeof name !== "string" || name === "") throw new TypeError("tools/call params.name is required");
  if (args !== undefined && !isObject(args)) throw new TypeError("tools/call params.arguments must be an object");
  return {
    tool: name,
    connector: connectorFromName(name),
    args: args === undefined ? {} : args,
  };
}

function connectorFromName(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function rewriteInitializeResult(message: JsonRpcMessage, session: Session, init: InitializeRequest): JsonRpcMessage {
  if (!("result" in message) || !isObject(message.result)) return message;
  const upstreamVersion = typeof message.result.protocolVersion === "string" ? message.result.protocolVersion : init.requestedVersion;
  return {
    ...message,
    id: init.agentId,
    result: {
      ...message.result,
      protocolVersion: session.negotiatedVersion(init.requestedVersion, upstreamVersion),
    },
  };
}

function cancellationFromAgent(notification: JsonRpcNotification, session: Session): JsonRpcNotification | null {
  if (notification.method !== "notifications/cancelled") return null;
  const params = notification.params;
  if (params === undefined) return null;
  const requestId = params.requestId;
  if (typeof requestId !== "number") return null;
  return session.translateCancellation(requestId);
}

async function* stdinLines(): AsyncIterable<string> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

function parseMessage(line: string): JsonRpcMessage {
  const parsed = JSON.parse(line) as unknown;
  if (!isObject(parsed) || parsed.jsonrpc !== "2.0") throw new TypeError("message must be a JSON-RPC 2.0 object");
  return parsed as JsonRpcMessage;
}

function jsonRpcError(id: JsonRpcId | null, code: number, message: string, data?: unknown): { readonly jsonrpc: "2.0"; readonly id: JsonRpcId | null; readonly error: JsonRpcErrorBody } {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

function isResponse(message: JsonRpcMessage): message is JsonRpcResult | JsonRpcError {
  return "result" in message || "error" in message;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProtocolVersion(params: JsonObject | undefined): string {
  return typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-11-25";
}

function isResourceMethod(method: string): boolean {
  return method === "resources/list" || method === "resources/read" || method === "resources/subscribe" || method === "resources/unsubscribe";
}

function isPromptMethod(method: string): boolean {
  return method === "prompts/list" || method === "prompts/get";
}

function normalizePosture(posture: ProxyPosture): "fail-closed" | "observe" {
  return posture === "observe" || posture === "observe-only" ? "observe" : "fail-closed";
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) out[key] = value;
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
