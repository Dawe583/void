import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { runReplayCommand } from "../../../packages/cli/src/replay.ts";
import type { ReplayCommandOptions } from "../../../packages/cli/src/replay.ts";
import { buildGraph, DATA_EDGE_HONESTY_NOTE } from "../../../packages/ledger/src/taint/graph.ts";
import { neighbors } from "../../../packages/ledger/src/taint/query.ts";
import { readLedgerEntries, verifyChain } from "../../../packages/ledger/src/verify.ts";
import { GENESIS_PREV } from "../../../packages/ledger/src/canonical.ts";
import { readLedgerFeed, type LedgerFeedRecord } from "../../../packages/ledger/src/feed.ts";
import type { PublicKeyLookup } from "../../../packages/ledger/src/verify.ts";
import { Workbench } from "../../../packages/workbench/src/index.ts";
import { authorizedRemote } from "./auth.ts";
import { localApprovals } from "./local-approvals.ts";
import { keyProviderFromPkcs8 } from "../../../packages/ledger/src/sign.ts";

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
  readonly replay?: ReplayCommandOptions;
};

export type ListenHandle = {
  readonly port: number;
  readonly server: Server;
  readonly close: () => Promise<void>;
};

type JsonObject = Record<string, unknown>;

type RouteOptions = {
  readonly workbench: Workbench;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly webRoot: string;
  readonly ledgerPath?: string;
  readonly approvals?: ApprovalBroker;
  readonly replay?: ReplayCommandOptions;
  readonly publicKey?: PublicKeyLookup;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const defaultWebRoot = resolve(here, "../web");
const maxBodyBytes = 64 * 1024;
const publicScriptPaths: ReadonlySet<string> = new Set(["/app.js", "/workbench.css", "/theme.js", "/sessions.js", "/workspace-ui.js", "/cloud-settings.js", "/manifest.webmanifest", "/icon.svg"]);

/**
 * Resolve a verification key without ever generating one. Reading is the
 * operator's trust domain: the server sits next to the ledger it serves, so
 * the same development key that signed locally is the honest default. When no
 * key material exists the lookup stays undefined and every feed and verify
 * view reports integrity without claiming authentication.
 */
async function resolveVerifyKey(env: Readonly<NodeJS.ProcessEnv>): Promise<PublicKeyLookup | undefined> {
  const inline = env.VOID_SIGNING_KEY;
  if (inline !== undefined && inline !== "") {
    const provider = keyProviderFromPkcs8(Buffer.from(inline, "base64"));
    return (keyId) => provider.publicKey(keyId);
  }
  const explicit = env.VOID_VERIFY_KEY;
  if (explicit !== undefined && explicit !== "") {
    return new Uint8Array(Buffer.from(explicit, "base64"));
  }
  if (env === process.env) {
    try {
      const provider = keyProviderFromPkcs8(await readFile(join(homedir(), ".void", "keys", "dev-ed25519.pkcs8")));
      return keyId => provider.publicKey(keyId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return undefined;
}

export function createControlPlaneServer(options: ControlPlaneOptions = {}): Server {
  const env = options.env ?? process.env;
  const webRoot = resolve(options.webRoot ?? defaultWebRoot);

  const workbench = new Workbench(env);
  const server = createServer((request, response) => {
    if (env.VOID_CONTROL_TOKEN ? !authorizedRemote(request, env) : !isLocalRequest(request)) {
      sendJson(response, 403, { error: "local_origin_required" });
      return;
    }
    void resolveVerifyKey(env).then((publicKey) =>
      route(request, response, { ...options, env, webRoot, publicKey, workbench, approvals: workbench.list().length ? { pending: async () => [...await readPendingApprovals(options.approvals), ...workbench.pending()], decide: (id, decision) => id.includes(":") ? workbench.decide(id, decision) : options.approvals?.decide(id, decision) } : options.approvals })).catch(() => {
      sendJson(response, 500, {
        error: "internal_error",
        message: "The request failed; operator review required",
      });
    });
  });
  server.once("close", () => workbench.close());
  return server;
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

  if (parsed.pathname === "/api/provider") {
    try {
      if (request.method === "GET") return sendJson(response, 200, await options.workbench.providerState());
      if (request.method === "DELETE") { options.workbench.clearProvider(); return sendJson(response, 200, { ok: true }); }
      if (request.method === "POST") {
        const body = await readJsonBody(request) as { baseUrl?: string; apiKey?: string; kind?: "openai" | "anthropic" } | null;
        if (typeof body?.baseUrl !== "string" || typeof body.apiKey !== "string") return sendJson(response, 400, { error: "invalid_provider" });
        const models = await options.workbench.configure({ baseUrl: body.baseUrl, apiKey: body.apiKey, kind: body.kind });
        return sendJson(response, 200, { connected: true, models, keyStorage: "encrypted-local" });
      }
    } catch (error) { return sendJson(response, 400, { error: "provider_unavailable", message: error instanceof Error ? error.message : "Provider unavailable" }); }
  }
  if (parsed.pathname === '/api/connectors') {
    try {
      if (request.method === 'GET') return sendJson(response, 200, options.workbench.connectionState());
      if (request.method === 'POST') {
        const body = await readJsonBody(request) as { url: string; name?: string; token?: string; policy?: string; facts?: Record<string, boolean | string>; mapping?: Record<string, string> };
        return sendJson(response, 200, await options.workbench.addConnector(body));
      }
    } catch (error) { return sendJson(response, 400, { message: error instanceof Error ? error.message : 'Connector unavailable.' }); }
  }
  const connectorMatch = /^\/api\/connectors\/([a-f0-9-]+)$/.exec(parsed.pathname);
  if (connectorMatch && request.method === 'DELETE') { options.workbench.removeConnector(connectorMatch[1]!); return sendJson(response, 200, { ok: true }); }
  const workspaceMatch = /^\/api\/sessions\/([a-f0-9-]+)\/(workspace|undo)(?:\/([A-Za-z0-9_.:-]+))?$/.exec(parsed.pathname);
  if (workspaceMatch) {
    try {
      const id = workspaceMatch[1]!, operation = workspaceMatch[3]!;
      if (workspaceMatch[2] === 'workspace' && request.method === 'GET') return sendJson(response, 200, { workspace: options.workbench.workspace(id) });
      if (workspaceMatch[2] === 'undo' && request.method === 'GET') return sendJson(response, 200, await options.workbench.undoPreview(id, operation));
      if (workspaceMatch[2] === 'undo' && request.method === 'POST') {
        const body = await readJsonBody(request) as { confirm?: string };
        if (body.confirm !== operation) return sendJson(response, 409, { message: 'Preview and confirm this change first.' });
        return sendJson(response, 200, await options.workbench.undo(id, operation));
      }
    } catch (error) { return sendJson(response, 409, { message: error instanceof Error ? error.message : 'Workspace operation failed.' }); }
  }
  if (request.method === 'GET' && ['/api/feed', '/api/ledger/verify', '/api/ledger/export'].includes(parsed.pathname)) {
    const workspace = parsed.searchParams.get('workspace') || options.workbench.list().at(-1)?.workspace;
    const proof = workspace ? await options.workbench.ledger(workspace) : undefined;
    if (proof && proof.entries.length) {
      if (parsed.pathname === '/api/feed') return sendJson(response, 200, { entries: proof.entries.slice(-50).map(e => ({ seq: e.seq, ...(e.body as JsonObject), hash: e.hash, digest: e.hash, prev_hash: e.prev_hash })), verified: true, signed: true, integrity: true });
      if (parsed.pathname === '/api/ledger/verify') return sendJson(response, 200, { ok: true, verified: true, signed: true, integrity: true, checked: proof.entries.length, head: proof.result.head });
      response.setHeader('content-disposition', 'attachment; filename="void-ledger.json"');
      return sendJson(response, 200, { format: 'void.signed-ledger.v1', entries: proof.entries });
    }
  }
  if (parsed.pathname === "/api/sessions") {
    if (request.method === "GET") return sendJson(response, 200, { sessions: options.workbench.list() });
    if (request.method === "POST") {
      const body = await readJsonBody(request) as { prompt?: string; model?: string } | null;
      if (typeof body?.prompt !== "string" || typeof body.model !== "string") return sendJson(response, 400, { error: "invalid_session" });
      try { return sendJson(response, 201, { session: await options.workbench.start(body.prompt, body.model) }); }
      catch (error) { return sendJson(response, 409, { error: "session_not_started", message: error instanceof Error ? error.message : "Session not started" }); }
    }
  }
  const sessionMatch = /^\/api\/sessions\/([a-f0-9-]+)$/.exec(parsed.pathname);
  if (sessionMatch) {
    const id = sessionMatch[1]!;
    const session = options.workbench.get(id);
    if (!session) return sendJson(response, 404, { error: "session_not_found" });
    if (request.method === "GET") return sendJson(response, 200, { session });
    if (request.method === "DELETE") { options.workbench.cancel(id); return sendJson(response, 200, { ok: true }); }
    if (request.method === "POST") {
      const body = await readJsonBody(request) as { prompt?: string } | null;
      if (typeof body?.prompt !== "string") return sendJson(response, 400, { error: "invalid_message" });
      try { options.workbench.send(id, body.prompt); return sendJson(response, 202, { ok: true }); }
      catch (error) { return sendJson(response, 409, { error: "session_not_ready", message: error instanceof Error ? error.message : "Session not ready" }); }
    }
  }
  const recordAction = /^\/api\/records\/(\d+)\/(taint|replay)$/.exec(parsed.pathname);
  if (recordAction && (request.method === "GET" || request.method === "POST")) {
    const seq = Number(recordAction[1]);
    const workspace = parsed.searchParams.get('workspace') || options.workbench.list().at(-1)?.workspace;
    const managed = workspace ? options.workbench.list().find(s => s.workspace === workspace) : undefined;
    const proof = managed ? await options.workbench.ledger(managed.workspace) : undefined;
    if (managed && proof?.entries.length) {
      const entry = proof.entries.find(e => e.seq === seq);
      if (!entry) return sendJson(response, 404, { message: 'Record not found.' });
      if (recordAction[2] === 'taint') return sendJson(response, 200, { ...neighbors(buildGraph(proof.entries), entry.hash, 8), note: DATA_EDGE_HONESTY_NOTE, signed: true });
      const operationId = (entry.body as JsonObject).operationId;
      if (typeof operationId !== 'string') return sendJson(response, 409, { message: 'This call has no captured document inverse.' });
      try {
        const preview = await options.workbench.undoPreview(managed.id, operationId);
        if (request.method === 'POST') {
          const body = await readJsonBody(request) as { digest?: string };
          if (body.digest !== entry.hash) return sendJson(response, 409, { message: 'Preview this exact record first.' });
          await options.workbench.undo(managed.id, operationId);
        }
        return sendJson(response, 200, { digest: entry.hash, canApply: preview.canApply, lines: [preview.path, preview.reason ?? 'Captured inverse verified.', `Current:\n${preview.before ?? '(absent)'}`, `After Undo:\n${preview.after ?? '(absent)'}`, ...(request.method === 'POST' ? ['Undo applied.'] : [])] });
      } catch (error) { return sendJson(response, 409, { message: error instanceof Error ? error.message : 'Undo refused.' }); }
    }
    const ledger = selectLedgerPath(options, parsed.searchParams.get("workspace"));
    if (!ledger || !Number.isSafeInteger(seq) || seq < 1) return sendJson(response, 400, { error: "invalid_record" });
    const entries = await readLedgerEntries(ledger);
    const verified = await verifyChain(entries, { publicKey: options.publicKey });
    if (!verified.ok) return sendJson(response, 409, { error: "ledger_verification_failed" });
    const entry = entries.find(item => item.seq === seq);
    if (!entry) return sendJson(response, 404, { error: "record_not_found" });
    if (recordAction[2] === "taint" && request.method === "GET") {
      const graph = neighbors(buildGraph(entries), entry.hash, 8);
      return sendJson(response, 200, { ...graph, note: DATA_EDGE_HONESTY_NOTE, signed: options.publicKey !== undefined });
    }
    if (recordAction[2] === "replay") {
      const apply = request.method === "POST";
      if (apply) {
        const body = await readJsonBody(request) as { digest?: string } | null;
        if (body?.digest !== entry.hash) return sendJson(response, 409, { error: "preview_digest_required" });
        if (!options.publicKey) return sendJson(response, 409, { error: "signature_key_required", message: "Replay requires verified signatures." });
      }
      const snapshots = options.env.VOID_SNAPSHOT_DIR;
      if (!snapshots) return sendJson(response, 409, { error: "snapshots_not_configured", message: "Set VOID_SNAPSHOT_DIR on the runtime to preview captured inverses." });
      const lines: string[] = [];
      const errors: string[] = [];
      const code = await runReplayCommand(["--ledger", ledger, "--snapshot-dir", snapshots, "--seq", String(seq), ...(apply ? [] : ["--dry-run"])], { stdout: line => lines.push(line), stderr: line => errors.push(line), env: options.env }, options.replay);
      return sendJson(response, code === 0 ? 200 : 409, { ok: code === 0, digest: entry.hash, preview: !apply, lines, message: errors.join("\n") });
    }
  }
  if (request.method === "GET" && parsed.pathname === "/api/ledger/export") {
    const ledger = selectLedgerPath(options, parsed.searchParams.get("workspace"));
    if (!ledger) return sendJson(response, 400, { error: "invalid_workspace" });
    const page = await readLedgerFeed(ledger, { publicKey: options.publicKey });
    response.setHeader("content-disposition", 'attachment; filename="void-records.json"');
    return sendJson(response, 200, { format: "void.records.v1", note: "Record metadata export. Use void attest for offline signed attestation.", signed: page.signed, entries: page.records.map(toApiEntry) });
  }
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
  try { await stat(ledgerPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return sendJson(response, 404, { error: "ledger_not_found", message: "No recorded calls yet. Start an agent session or connect an existing VOID workspace." });
    throw error;
  }
  const page = await readLedgerFeed(ledgerPath, { publicKey: options.publicKey });
  const entries = page.records.slice(-limit).map(toApiEntry);
  sendJson(response, 200, { entries, verified: page.signed, integrity: true, signed: page.signed });
}

async function handleVerify(response: ServerResponse, options: RouteOptions, searchParams: URLSearchParams): Promise<void> {
  const ledgerPath = selectLedgerPath(options, searchParams.get("workspace"));
  if (ledgerPath === null) return sendJson(response, 400, { error: "invalid_workspace" });
  try {
    const page = await readLedgerFeed(ledgerPath, { publicKey: options.publicKey });
    sendJson(response, 200, {
      ok: true,
      verified: page.signed,
      integrity: true,
      signed: page.signed,
      checked: page.records.length,
      head: page.head,
    });
  } catch (error) {
    sendJson(response, 200, {
      setup: (error as NodeJS.ErrnoException).code === "ENOENT",
      ok: false,
      verified: false,
      integrity: false,
      signed: false,
      checked: 0,
      head: GENESIS_PREV,
      reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "No ledger yet. Run an agent through void-proxy in this workspace, then refresh." : "Ledger integrity or signature validation failed. Inspect the ledger locally before trusting these records.",
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
  response.setHeader("cache-control", "no-store");
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

// Host validation blocks DNS rebinding; Origin and Fetch Metadata block hostile
// browser pages. This is a local boundary, not authentication between local users.
function isLocalRequest(request: IncomingMessage): boolean {
  const peer = request.socket.remoteAddress;
  if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return false;
  const port = request.socket.localPort;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = request.headers.host;
  if (host === undefined || !hosts.has(host)) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  const site = request.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
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
  // Browsers block cross-origin application/json form posts behind a preflight,
  // but a text/plain form body can still be crafted to parse as JSON. Requiring
  // the explicit content type keeps the decision endpoint a fetch-only surface,
  // so a hostile page cannot post a decision through a victim browser session.
  const contentType = request.headers["content-type"];
  if (contentType === undefined || !applicationJsonContentType(contentType)) return null;
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

function applicationJsonContentType(header: string): boolean {
  const [mediaType] = header.split(";", 2);
  return mediaType.trim().toLowerCase() === "application/json";
}

function sendJson(response: ServerResponse, statusCode: number, value: JsonObject): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
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
  if (!normalized.endsWith(".html") && !publicScriptPaths.has(normalized)) return null;
  const target = resolve(join(webRoot, normalized));
  const inside = relative(webRoot, target);
  if (inside.startsWith("..") || inside === "" || inside.includes(":") || resolve(webRoot, inside) !== target) return null;
  return target;
}

function contentType(filePath: string): string {
  if (extname(filePath) === ".html") return "text/html; charset=utf-8";
  if (extname(filePath) === ".webmanifest") return "application/manifest+json";
  if (extname(filePath) === ".svg") return "image/svg+xml";
  if (extname(filePath) === ".css") return "text/css; charset=utf-8";
  if (extname(filePath) === ".js") return "application/javascript; charset=utf-8";
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
  createControlPlaneServer({ approvals: localApprovals(process.env) }).listen(port, process.env.VOID_CONTROL_TOKEN && process.env.VOID_CONTROL_TOKEN.length >= 32 ? process.env.VOID_CONTROL_HOST ?? "127.0.0.1" : "127.0.0.1", () => {
    console.log(`VOID control plane API listening on http://127.0.0.1:${port}`);
  });
}
