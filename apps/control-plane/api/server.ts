import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { GENESIS_PREV } from "../../../packages/ledger/src/canonical.ts";
import { readLedgerFeed, type LedgerFeedRecord } from "../../../packages/ledger/src/feed.ts";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type PendingApproval = {
  readonly holdId: string;
  readonly call: unknown;
  readonly expiresAt: string | number;
  readonly status: ApprovalStatus;
};

export type ApprovalDecision = {
  readonly kind: "approved" | "denied";
  readonly by: string;
  readonly reason?: string;
};

export type ApprovalBroker = {
  readonly pending?: () => Promise<readonly PendingApproval[]> | readonly PendingApproval[];
  readonly listPending?: () => Promise<readonly PendingApproval[]> | readonly PendingApproval[];
  readonly decide: (holdId: string, decision: ApprovalDecision) => Promise<unknown> | unknown;
};

export type ControlPlaneOptions = {
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly webRoot?: string;
  readonly ledgerPath?: string;
  readonly approvals?: ApprovalBroker;
};

export type ListenHandle = {
  readonly port: number;
  readonly server: Server;
  readonly close: () => Promise<void>;
};

type JsonObject = Record<string, unknown>;

type RouteOptions = {
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly webRoot: string;
  readonly ledgerPath?: string;
  readonly approvals?: ApprovalBroker;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const defaultWebRoot = resolve(here, "../web");
const maxBodyBytes = 64 * 1024;

export function createControlPlaneServer(options: ControlPlaneOptions = {}): Server {
  const env = options.env ?? process.env;
  const webRoot = resolve(options.webRoot ?? defaultWebRoot);

  return createServer((request, response) => {
    void route(request, response, { ...options, env, webRoot }).catch((error: unknown) => {
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

export async function listenControlPlane(options: ControlPlaneOptions = {}): Promise<ListenHandle> {
  const server = createControlPlaneServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("control plane did not bind a TCP port");
  return {
    port: address.port,
    server,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
    }),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: RouteOptions,
): Promise<void> {
  const parsed = parseRequestUrl(request);
  if (parsed === null) return sendJson(response, 400, { error: "bad_url" });

  if (request.method === "GET" && parsed.pathname === "/api/feed") {
    return handleFeed(response, options, parsed.searchParams);
  }
  if (request.method === "GET" && parsed.pathname === "/api/ledger/verify") {
    return handleVerify(response, options, parsed.searchParams);
  }
  if (request.method === "GET" && parsed.pathname === "/api/approvals") {
    return handleApprovals(response, options.approvals);
  }
  const approvalMatch = /^\/api\/approvals\/([^/]+)\/decision$/.exec(parsed.pathname);
  if (request.method === "POST" && approvalMatch !== null) {
    return handleApprovalDecision(request, response, options.approvals, decodeURIComponent(approvalMatch[1]!));
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return serveStatic(request, response, options.webRoot, parsed.pathname);
  }
  sendJson(response, 404, { error: "not_found" });
}

async function handleFeed(response: ServerResponse, options: RouteOptions, searchParams: URLSearchParams): Promise<void> {
  const limit = parseLimit(searchParams.get("limit"));
  const ledgerPath = selectLedgerPath(options, searchParams.get("workspace"));
  if (ledgerPath === null) return sendJson(response, 400, { error: "invalid_workspace" });
  const page = await readLedgerFeed(ledgerPath);
  const entries = page.records.slice(-limit).map(toApiEntry);
  sendJson(response, 200, { entries, verified: page.verified });
}

async function handleVerify(response: ServerResponse, options: RouteOptions, searchParams: URLSearchParams): Promise<void> {
  const ledgerPath = selectLedgerPath(options, searchParams.get("workspace"));
  if (ledgerPath === null) return sendJson(response, 400, { error: "invalid_workspace" });
  try {
    const page = await readLedgerFeed(ledgerPath);
    sendJson(response, 200, { ok: true, verified: true, checked: page.records.length, head: page.head });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      verified: false,
      checked: 0,
      head: GENESIS_PREV,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleApprovals(response: ServerResponse, approvals: ApprovalBroker | undefined): Promise<void> {
  const pending = await readPendingApprovals(approvals);
  sendJson(response, 200, { approvals: pending.map(toApiApproval) });
}

async function handleApprovalDecision(
  request: IncomingMessage,
  response: ServerResponse,
  approvals: ApprovalBroker | undefined,
  holdId: string,
): Promise<void> {
  if (approvals === undefined) {
    return sendJson(response, 503, {
      error: "approvals_not_wired",
      message: "ApprovalBroker is not wired into this server yet",
    });
  }

  const body = await readJsonBody(request);
  const decision = parseDecision(body);
  if (decision === null) return sendJson(response, 400, { error: "invalid_decision" });
  const result = await approvals.decide(holdId, decision);
  sendJson(response, 200, { ok: true, result });
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  webRoot: string,
  pathname: string,
): Promise<void> {
  const filePath = staticPath(webRoot, pathname);
  if (filePath === null) return sendJson(response, 404, { error: "not_found" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return sendJson(response, 404, { error: "not_found" });
  } catch {
    return sendJson(response, 404, { error: "not_found" });
  }
  response.statusCode = 200;
  response.setHeader("content-type", contentType(filePath));
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise<void>((resolvePipe, rejectPipe) => {
    const stream = createReadStream(filePath);
    stream.once("error", rejectPipe);
    response.once("error", rejectPipe);
    response.once("finish", resolvePipe);
    stream.pipe(response);
  });
}

function toApiEntry(record: LedgerFeedRecord): JsonObject {
  return {
    seq: record.seq,
    at: record.at,
    tool: record.tool,
    klass: record.klass,
    decision: record.decision,
    argsDigest: record.argsDigest,
    prev_hash: record.prevDigest,
    hash: record.digest,
    digest: record.digest,
  };
}

function toApiApproval(record: PendingApproval): JsonObject {
  return {
    holdId: record.holdId,
    call: record.call,
    expiresAt: record.expiresAt,
    status: record.status,
  };
}

function parseRequestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

function parseLimit(raw: string | null): number {
  if (raw === null) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

async function readPendingApprovals(approvals: ApprovalBroker | undefined): Promise<readonly PendingApproval[]> {
  if (approvals?.listPending !== undefined) return approvals.listPending();
  if (approvals?.pending !== undefined) return approvals.pending();
  return [];
}

function parseDecision(value: unknown): ApprovalDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (body.kind !== "approved" && body.kind !== "denied") return null;
  if (typeof body.by !== "string" || body.by === "") return null;
  if (body.reason !== undefined && typeof body.reason !== "string") return null;
  return body.reason === undefined
    ? { kind: body.kind, by: body.by }
    : { kind: body.kind, by: body.by, reason: body.reason };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("request body exceeds 64 KiB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, statusCode: number, value: JsonObject): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function staticPath(webRoot: string, pathname: string): string | null {
  const name = pathname === "/" ? "/index.html" : pathname;
  let normalized: string;
  try {
    normalized = normalize(decodeURIComponent(name));
  } catch {
    return null;
  }
  if (!normalized.endsWith(".html")) return null;
  const target = resolve(join(webRoot, normalized));
  const inside = relative(webRoot, target);
  if (inside.startsWith("..") || inside === "" || inside.includes(":") || resolve(webRoot, inside) !== target) return null;
  return target;
}

function contentType(filePath: string): string {
  if (extname(filePath) === ".html") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function selectLedgerPath(options: RouteOptions, workspace: string | null): string | null {
  if (options.ledgerPath !== undefined) return options.ledgerPath;
  const name = workspace ?? options.env.VOID_WORKSPACE ?? "default";
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  const dir = options.env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger");
  return join(dir, `${name}.jsonl`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT ?? "8081", 10);
  createControlPlaneServer().listen(port, "127.0.0.1", () => {
    console.log(`VOID control plane API listening on http://127.0.0.1:${port}`);
  });
}
