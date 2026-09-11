import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { start } from "workflow/api";
import { runCloudSession } from "./workflow.mjs";
import {
  read,
  write,
  sessions,
  transaction,
  encrypt,
  decrypt,
  event,
  view,
  ledger,
} from "./store.mjs";
import { provider, providerState } from "./provider.mjs";
import { catalog, validateEndpoint } from "./mcp.mjs";
import { CLOUD_POLICY } from "./steps.mjs";
import { loadPolicy } from "../packages/policy/src/rules.ts";
import {
  buildGraph,
  DATA_EDGE_HONESTY_NOTE,
} from "../packages/ledger/src/taint/graph.ts";
import { neighbors } from "../packages/ledger/src/taint/query.ts";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
const matches = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  b.length >= 32 &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.use((req, res, next) => {
  res.set({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  const token = process.env.VOID_CONTROL_TOKEN;
  if (!token || token.length < 32)
    return res.status(503).json({
      error: "setup_required",
      message: "Cloud access is being configured.",
    });
  if (
    req.headers.origin &&
    req.headers.origin !== `https://${req.headers.host}` &&
    !(
      process.env.VOID_LOCAL_TEST === "1" &&
      req.headers.origin === `http://${req.headers.host}`
    )
  )
    return res.status(403).json({ error: "origin_rejected" });
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "origin_rejected" });
  if (req.path === "/api/session" && req.method === "POST") {
    if (!matches(req.body?.token, token))
      return res.status(401).json({
        error: "invalid_token",
        message: "The access token was not accepted.",
      });
    res.setHeader(
      "set-cookie",
      `__Host-void-session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
    );
    return res.json({ ok: true });
  }
  if (req.path === "/api/session" && req.method === "DELETE") {
    res.setHeader(
      "set-cookie",
      "__Host-void-session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    );
    return res.json({ ok: true });
  }
  let cookie;
  try {
    cookie = decodeURIComponent(
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("__Host-void-session="))
        ?.slice(20) ?? "",
    );
  } catch {}
  if (
    !matches(cookie, token) &&
    !matches(req.headers.authorization?.replace(/^Bearer /, ""), token)
  )
    return res.status(401).json({
      error: "authentication_required",
      message: "Enter your workspace access token to connect.",
    });
  next();
});
app.get("/api/provider", async (req, res) => res.json(await providerState()));
app.post("/api/provider", async (req, res) => {
  if (
    typeof req.body?.baseUrl !== "string" ||
    typeof req.body?.apiKey !== "string"
  )
    return res.status(400).json({ message: "Provide a provider URL and key." });
  validateEndpoint(req.body.baseUrl);
  const secret = encrypt({
    baseUrl: req.body.baseUrl,
    apiKey: req.body.apiKey,
  });
  const client = await provider({ secret });
  const models = await client.models();
  await write("provider", { secret });
  res.json({ connected: true, models, keyStorage: "encrypted-cloud" });
});
app.delete("/api/provider", async (req, res) => {
  await write("provider", { disabled: true });
  res.json({ ok: true });
});
app.get("/api/upstream", async (req, res) => {
  const saved = await read("upstream");
  const config = saved ? decrypt(saved) : {};
  res.json({
    url: config.url ?? "",
    configured: !!config.url,
    policy: config.policy ?? CLOUD_POLICY,
    facts: config.facts ?? {},
    mapping: config.mapping ?? {},
  });
});
app.post("/api/upstream", async (req, res) => {
  const body = req.body;
  if (
    !body ||
    typeof body.url !== "string" ||
    typeof body.policy !== "string" ||
    !loadPolicy(body.policy).ok
  )
    return res
      .status(400)
      .json({ message: "Enter an HTTPS MCP URL and valid VOID policy." });
  for (const field of ["facts", "mapping"])
    if (
      !body[field] ||
      typeof body[field] !== "object" ||
      Array.isArray(body[field])
    )
      return res
        .status(400)
        .json({ message: `${field} must be a JSON object.` });
  if (
    Object.values(body.facts).some(
      (v) => typeof v !== "boolean" && typeof v !== "string",
    ) ||
    Object.values(body.mapping).some((v) => typeof v !== "string")
  )
    return res
      .status(400)
      .json({ message: "Invalid facts or tool mapping values." });
  const config = {
    url: validateEndpoint(body.url),
    token: typeof body.token === "string" ? body.token : "",
    policy: body.policy,
    facts: body.facts,
    mapping: body.mapping,
  };
  const listed = await catalog(config);
  await write("upstream", encrypt(config));
  res.json({ configured: true, tools: listed.tools.map((t) => t.name) });
});
app.delete("/api/upstream", async (req, res) => {
  await write("upstream", null);
  res.json({ ok: true });
});
app.get("/api/sessions", async (req, res) =>
  res.json({
    sessions: (await sessions()).map((s) => ({ ...view(s), events: [] })),
  }),
);
async function launch(session) {
  try {
    const run = await start(runCloudSession, [session.id, session.generation]);
    await transaction(session.id, async (c) => {
      const s = await read(`session:${session.id}`, c);
      s.runId = run.runId;
      await write(`session:${s.id}`, s, c);
    });
  } catch {
    await transaction(session.id, async (c) => {
      const s = await read(`session:${session.id}`, c);
      s.status = "failed";
      event(s, "error", "The cloud workflow could not start.");
      await write(`session:${s.id}`, s, c);
    });
    throw new Error("Workflow could not start.");
  }
}
app.post("/api/sessions", async (req, res) => {
  const { prompt, model } = req.body ?? {};
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > 32000 ||
    typeof model !== "string"
  )
    return res
      .status(400)
      .json({ message: "Enter a message and select a model." });
  const state = await providerState();
  if (!state.connected || !state.models.some((m) => m.id === model))
    return res
      .status(409)
      .json({ message: "Select a model from the connected provider." });
  const upstream = await read("upstream"),
    listed = upstream ? await catalog(decrypt(upstream)) : { tools: [] };
  const id = randomUUID(),
    session = {
      id,
      workspace: `agent-${id}`,
      createdAt: new Date().toISOString(),
      model,
      status: "running",
      events: [],
      messages: [
        {
          role: "system",
          content:
            "You operate through VOID. Every tool is classified and recorded before execution. Respect denials and never retry them with altered arguments. Do not claim an action completed without its tool result.",
        },
        { role: "user", content: prompt },
      ],
      tools: listed.tools,
      mcpSession: listed.sessionId,
      upstream,
      provider: (await read("provider")) ?? { mode: "gateway" },
      generation: 1,
      turn: 0,
      queue: [],
    };
  event(session, "user", prompt);
  await transaction("cloud-capacity", async (c) => {
    const all = await sessions();
    if (all.some((s) => s.status === "running"))
      throw new Error("An agent is already running.");
    await write(`session:${id}`, session, c);
  });
  await launch(session);
  res.status(201).json({ session: view(session) });
});
app.get("/api/sessions/:id", async (req, res) => {
  const s = await read(`session:${req.params.id}`);
  return s
    ? res.json({ session: view(s) })
    : res.status(404).json({ message: "Session not found." });
});
app.post("/api/sessions/:id", async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 32000)
    return res
      .status(400)
      .json({ message: "Enter a message up to 32000 characters." });
  const s = await transaction("cloud-capacity", async (c) => {
    const current = await read(`session:${req.params.id}`, c);
    if (!current || current.status !== "idle" || current.messages.length >= 199)
      throw new Error(
        "Start a new session or wait for this session to finish.",
      );
    if ((await sessions()).some((s) => s.status === "running"))
      throw new Error("An agent is already running.");
    current.messages.push({ role: "user", content: prompt });
    event(current, "user", prompt);
    current.status = "running";
    current.generation++;
    current.turn = 0;
    await write(`session:${current.id}`, current, c);
    return current;
  });
  await launch(s);
  res.status(202).json({ ok: true });
});
app.delete("/api/sessions/:id", async (req, res) => {
  await transaction(req.params.id, async (c) => {
    const s = await read(`session:${req.params.id}`, c);
    if (!s) throw new Error("Session not found.");
    s.status = "cancelled";
    event(
      s,
      "user",
      "Cancellation requested. An already dispatched tool may finish; no further tools will start.",
    );
    await write(`session:${s.id}`, s, c);
  });
  res.json({ ok: true });
});
app.get("/api/approvals", async (req, res) => {
  const all = await sessions();
  const approvals = [];
  for (const s of all)
    if (s.status === "running" && s.pending) {
      const h = await read(`hold:${s.pending.id}`);
      if (h?.status === "pending" && h.expiresAt > Date.now())
        approvals.push(h);
    }
  res.json({ approvals });
});
app.post("/api/approvals/:id/decision", async (req, res) => {
  const decision = req.body?.kind;
  if (!["approved", "denied"].includes(decision))
    return res.status(400).json({ message: "Choose approved or denied." });
  const hold = await read(`hold:${req.params.id}`);
  if (!hold) return res.status(404).json({ message: "Hold not found." });
  await transaction(hold.sessionId, async (c) => {
    const h = await read(`hold:${req.params.id}`, c);
    const s = await read(`session:${h.sessionId}`, c);
    if (
      h.status !== "pending" ||
      h.expiresAt <= Date.now() ||
      s.status !== "running"
    )
      throw new Error("Hold already resolved or expired.");
    h.status = decision;
    h.decidedAt = Date.now();
    h.by = "web-operator";
    await write(`hold:${h.holdId}`, h, c);
  });
  res.json({ ok: true, result: { queued: true } });
});
async function selected(req) {
  const workspace =
    req.query.workspace ?? (await sessions())[0]?.workspace ?? "default";
  if (typeof workspace !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(workspace))
    throw new Error("Invalid workspace.");
  return ledger(workspace);
}
const record = (e) => ({
  seq: e.seq,
  ...e.body,
  prev_hash: e.prev_hash,
  hash: e.hash,
  digest: e.hash,
});
app.get("/api/feed", async (req, res) => {
  const { entries } = await selected(req);
  res.json({
    entries: entries.slice(-50).map(record),
    verified: true,
    integrity: true,
    signed: true,
  });
});
app.get("/api/ledger/verify", async (req, res) => {
  const { entries, result } = await selected(req);
  res.json({
    ok: true,
    verified: true,
    integrity: true,
    signed: true,
    checked: entries.length,
    head: result.head,
  });
});
app.get("/api/ledger/export", async (req, res) => {
  const { entries } = await selected(req);
  res.setHeader(
    "content-disposition",
    'attachment; filename="void-ledger.json"',
  );
  res.json({ format: "void.signed-ledger.v1", entries });
});
app.get("/api/records/:seq/taint", async (req, res) => {
  const { entries } = await selected(req);
  const e = entries.find((e) => e.seq === Number(req.params.seq));
  if (!e) return res.status(404).json({ message: "Record not found." });
  res.json({
    ...neighbors(buildGraph(entries), e.hash, 8),
    note: DATA_EDGE_HONESTY_NOTE,
    signed: true,
  });
});
app.all("/api/records/:seq/replay", (req, res) =>
  res.status(409).json({
    message:
      "This remote MCP call has no captured inverse. VOID refuses to invent an undo operation.",
  }),
);
app.use((req, res) => res.status(404).json({ error: "not_found" }));
app.use((error, req, res, next) => {
  res.status(400).json({
    error: "request_failed",
    message:
      "The cloud request failed. Check configuration, session status and provider access.",
  });
});
export default app;
