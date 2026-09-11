import { Pool, neonConfig } from "@neondatabase/serverless";
neonConfig.webSocketConstructor = WebSocket;
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { devKeyProvider, sha256Hex } from "../packages/ledger/src/sign.ts";
import { entryHash, GENESIS_PREV } from "../packages/ledger/src/canonical.ts";
import { signingPreimage } from "../packages/ledger/src/index.ts";
import { verifyChain } from "../packages/ledger/src/verify.ts";
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
export async function write(key, value, client = database()) {
  await client.query(
    "INSERT INTO void_cloud_state(key, document) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET document=EXCLUDED.document",
    [key, JSON.stringify(value)],
  );
}
export async function sessions() {
  return (
    await database().query(
      "SELECT document FROM void_cloud_state WHERE key LIKE 'session:%' AND document->>'workspace' NOT LIKE 'qa-%' ORDER BY document->>'createdAt' DESC LIMIT 100",
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
export function event(session, kind, text) {
  session.events.push({
    seq: (session.events.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    kind,
    text: String(text).slice(0, 32000),
  });
  session.events = session.events.slice(-200);
}
export function view(session) {
  return {
    id: session.id,
    workspace: session.workspace,
    model: session.model,
    title: session.title,
    status: session.status,
    events: session.events,
  };
}
