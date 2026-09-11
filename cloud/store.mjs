import { Pool, neonConfig } from "@neondatabase/serverless";
neonConfig.webSocketConstructor = WebSocket;
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { devKeyProvider, sha256Hex } from "../packages/ledger/src/sign.ts";
import { entryHash, GENESIS_PREV } from "../packages/ledger/src/canonical.ts";
import { signingPreimage } from "../packages/ledger/src/index.ts";
import { verifyChain } from "../packages/ledger/src/verify.ts";
import { PROVIDER_PRESETS } from "../packages/workbench/src/provider-defaults.ts";
let pool;
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("Cloud database is not configured.");
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  }));
}
export async function transaction(key, run) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function read(key, client = database()) {
  return (
    await client.query("SELECT document FROM void_cloud_state WHERE key=$1", [
      key,
    ])
  ).rows[0]?.document;
}
export async function write(key, value, client) {
  if (!client) return transaction(key, (c) => write(key, value, c));
  if (key.startsWith("session:") && value?.events?.length) {
    await client.query(
      "INSERT INTO void_cloud_events(session_id,seq,event) SELECT $1,(e->>'seq')::integer,e FROM jsonb_array_elements($2::jsonb) e ON CONFLICT DO NOTHING",
      [value.id, JSON.stringify(value.events)],
    );
  }
  await client.query(
    "INSERT INTO void_cloud_state(key, document) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET document=EXCLUDED.document",
    [
      key,
      JSON.stringify(
        key.startsWith("session:") && value?.events
          ? { ...value, events: value.events.slice(-200) }
          : value,
      ),
    ],
  );
}
export async function sessions() {
  return (
    await database().query(
      "SELECT document - 'messages' - 'events' - 'provider' - 'connected' - 'tools' - 'upstream' - 'pending' - 'queue' AS document FROM void_cloud_state WHERE key LIKE 'session:%' AND document->>'workspace' NOT LIKE 'qa-%' ORDER BY document->>'createdAt' DESC",
    )
  ).rows.map((row) => row.document);
}
export function encrypt(value) {
  const key = Buffer.from(process.env.VOID_SECRET_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new Error("Cloud encryption key is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value) {
  const [iv, tag, bytes] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.VOID_SECRET_KEY ?? "", "base64"),
    iv,
  );
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(bytes), cipher.final()]).toString(),
  );
}
export async function signer() {
  if (!process.env.VOID_SIGNING_KEY)
    throw new Error("Cloud signing key missing.");
  return devKeyProvider({ env: process.env });
}
export async function append(body, client) {
  const key = await signer();
  const previous = (
    await client.query(
      "SELECT entry FROM void_cloud_ledger WHERE workspace=$1 ORDER BY seq DESC LIMIT 1",
      [body.workspace],
    )
  ).rows[0]?.entry;
  const hash = await entryHash(body, previous?.hash ?? GENESIS_PREV, sha256Hex);
  const id = await key.currentKeyId();
  const entry = {
    workspace: body.workspace,
    seq: (previous?.seq ?? 0) + 1,
    body,
    prev_hash: previous?.hash ?? GENESIS_PREV,
    hash,
    key_id: id,
    alg: key.alg,
    signature: `${key.alg}:${Buffer.from(await key.sign(signingPreimage(key.alg, id, hash))).toString("base64")}`,
  };
  await client.query(
    "INSERT INTO void_cloud_ledger(workspace,seq,entry) VALUES($1,$2,$3)",
    [body.workspace, entry.seq, JSON.stringify(entry)],
  );
  return entry;
}
export async function ledger(workspace, client = database()) {
  const entries = (
    await client.query(
      "SELECT entry FROM void_cloud_ledger WHERE workspace=$1 ORDER BY seq",
      [workspace],
    )
  ).rows.map((row) => row.entry);
  const key = await signer();
  const result = await verifyChain(entries, {
    publicKey: (id) => key.publicKey(id),
  });
  if (!result.ok)
    throw new Error("Ledger signature or integrity verification failed.");
  return { entries, result };
}
export function event(session, kind, text, payload = {}, type) {
  const seq = (session.events.at(-1)?.seq ?? 0) + 1,
    at = new Date().toISOString();
  session.updatedAt = at;
  session.events.push({
    id: `${session.id}:${seq}`,
    sessionId: session.id,
    runId: `${session.id}:${session.generation ?? 0}`,
    seq,
    at,
    kind,
    text: String(text).slice(0, 32000),
    payload,
    type:
      type ??
      {
        user: "message.completed",
        assistant: "message.completed",
        tool: "tool.result",
        error: "run.error",
        usage: "usage.reported",
      }[kind],
    schemaVersion: 1,
  });
}
export function view(session) {
  let providerName;
  if (session.provider?.secret) {
    const config = decrypt(session.provider.secret);
    providerName =
      PROVIDER_PRESETS.find((p) => p.baseUrl === config.baseUrl)?.name ??
      new URL(config.baseUrl).hostname;
  } else if (session.provider?.mode) {
    providerName =
      PROVIDER_PRESETS.find((p) => p.id === session.provider.mode)?.name ??
      session.provider.mode;
  }
  const {
    id,
    workspace,
    model,
    title,
    status,
    events,
    createdAt,
    updatedAt,
    pinned,
    archived,
    project,
    tags,
    parentId,
    generation,
  } = session;
  return {
    id,
    workspace,
    model,
    providerName,
    title,
    status,
    events,
    createdAt,
    updatedAt,
    pinned,
    archived,
    project,
    tags,
    parentId,
    runId: `${id}:${generation ?? 0}`,
  };
}
export async function eventsAfter(id, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new Error("Invalid event cursor.");
  return (
    await database().query(
      "SELECT event FROM void_cloud_events WHERE session_id=$1 AND seq>$2 ORDER BY seq LIMIT 1000",
      [id, after],
    )
  ).rows.map((row) => row.event);
}

// Keyset pages return metadata only. Search never inspects encrypted credentials.
export async function sessionPage(query) {
  const { createHash } = await import("node:crypto");
  const signature = createHash("sha256")
    .update(
      [...query]
        .filter(([k]) => !["cursor", "limit"].includes(k))
        .sort()
        .toString(),
    )
    .digest("hex");
  const params = [],
    conditions = [
      "key LIKE 'session:%'",
      "document->>'workspace' NOT LIKE 'qa-%'",
    ];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (query.get("archived") !== "all")
    conditions.push(
      `COALESCE((document->>'archived')::boolean,false)=${bind(query.get("archived") === "true")}`,
    );
  for (const key of ["status", "model", "workspace"])
    if (query.get(key))
      conditions.push(`document->>'${key}'=${bind(query.get(key))}`);
  if (query.get("q")) {
    const q = bind(`%${query.get("q").replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(document->>'title' ILIKE ${q} OR EXISTS (SELECT 1 FROM void_cloud_events e WHERE e.session_id=document->>'id' AND e.event->>'text' ILIKE ${q}))`,
    );
  }
  for (const [key, op] of [
    ["from", ">="],
    ["to", "<="],
  ])
    if (query.get(key))
      conditions.push(`document->>'createdAt' ${op} ${bind(query.get(key))}`);
  const total = Number(
    (
      await database().query(
        `SELECT count(*) FROM void_cloud_state WHERE ${conditions.join(" AND ")}`,
        params,
      )
    ).rows[0].count,
  );
  const sort = ["title", "createdAt", "updatedAt", "model", "status"].includes(
    query.get("sort"),
  )
    ? query.get("sort")
    : "createdAt";
  const order = query.get("order") === "asc" ? "ASC" : "DESC",
    sign = order === "ASC" ? ">" : "<";
  const column = `COALESCE(document->>'${sort}','')`;
  if (query.get("cursor")) {
    const cursor = JSON.parse(
      Buffer.from(query.get("cursor"), "base64url").toString(),
    );
    if (
      cursor.filter !== signature ||
      typeof cursor.last !== "string" ||
      typeof cursor.id !== "string"
    )
      throw new Error("Invalid cursor.");
    conditions.push(
      `(${column},key) ${sign} (${bind(cursor.last)},${bind(cursor.id)})`,
    );
  }
  const limit = Math.min(100, Math.max(1, Number(query.get("limit")) || 50));
  const rows = (
    await database().query(
      `SELECT (document - 'messages' - 'events' - 'provider' - 'connected' - 'tools' - 'upstream' - 'pending' - 'queue') AS metadata, jsonb_array_length(COALESCE(document->'messages','[]'::jsonb)) AS message_count FROM void_cloud_state WHERE ${conditions.join(" AND ")} ORDER BY ${column} ${order},key ${order} LIMIT ${bind(limit + 1)}`,
      params,
    )
  ).rows;
  const hasMore = rows.length > limit,
    items = rows.slice(0, limit).map((r) => ({
      ...view({ ...r.metadata, events: [] }),
      messageCount: r.message_count,
    })),
    last = items.at(-1);
  return {
    items,
    sessions: items,
    total,
    hasMore,
    nextCursor: hasMore
      ? Buffer.from(
          JSON.stringify({
            filter: signature,
            last: last?.[sort] ?? "",
            id: `session:${last.id}`,
          }),
        ).toString("base64url")
      : null,
    asOf: new Date().toISOString(),
    scope: "retained-history",
  };
}
export async function ledgerPage(workspace, query) {
  const { createHash } = await import("node:crypto");
  const signature = createHash("sha256")
    .update(
      workspace +
        [...query]
          .filter(([k]) => !["cursor", "limit"].includes(k))
          .sort()
          .toString(),
    )
    .digest("hex");
  const params = [workspace],
    conditions = ["workspace=$1"],
    bind = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
  for (const key of ["tool", "klass", "decision"])
    if (query.get(key))
      conditions.push(`entry->'body'->>'${key}'=${bind(query.get(key))}`);
  if (query.get("outcome"))
    conditions.push(
      `entry->'body'->>'decision'=${bind(`execute:${query.get("outcome")}`)}`,
    );
  if (query.get("q"))
    conditions.push(
      `entry->'body'::text ILIKE ${bind(`%${query.get("q").replace(/[\\%_]/g, "\\$&")}%`)}`.replace(
        "entry->'body'::text",
        "(entry->'body')::text",
      ),
    );
  for (const [key, op] of [
    ["from", ">="],
    ["to", "<="],
  ])
    if (query.get(key))
      conditions.push(`entry->'body'->>'at' ${op} ${bind(query.get(key))}`);
  const total = Number(
      (
        await database().query(
          `SELECT count(*) FROM void_cloud_ledger WHERE ${conditions.join(" AND ")}`,
          params,
        )
      ).rows[0].count,
    ),
    asc = query.get("order") === "asc";
  if (query.get("cursor")) {
    const cursor = JSON.parse(
      Buffer.from(query.get("cursor"), "base64url").toString(),
    );
    if (cursor.filter !== signature || !Number.isSafeInteger(cursor.seq))
      throw new Error("Invalid cursor.");
    conditions.push(`seq ${asc ? ">" : "<"} ${bind(cursor.seq)}`);
  }
  const limit = Math.min(100, Math.max(1, Number(query.get("limit")) || 50));
  const rows = (
      await database().query(
        `SELECT entry FROM void_cloud_ledger WHERE ${conditions.join(" AND ")} ORDER BY seq ${asc ? "ASC" : "DESC"} LIMIT ${bind(limit + 1)}`,
        params,
      )
    ).rows.map((r) => r.entry),
    hasMore = rows.length > limit,
    items = rows.slice(0, limit).map((e) => ({
      seq: e.seq,
      ...e.body,
      prev_hash: e.prev_hash,
      hash: e.hash,
      digest: e.hash,
    }));
  return {
    items,
    entries: items,
    total,
    hasMore,
    nextCursor: hasMore
      ? Buffer.from(
          JSON.stringify({ filter: signature, seq: items.at(-1).seq }),
        ).toString("base64url")
      : null,
    scope: workspace,
    asOf: new Date().toISOString(),
    verified: false,
    integrity: null,
    signed: true,
    verificationRequired: true,
  };
}

export async function allEvents(id, client = database()) {
  return (
    await client.query(
      "SELECT event FROM void_cloud_events WHERE session_id=$1 ORDER BY seq",
      [id],
    )
  ).rows.map((row) => row.event);
}
