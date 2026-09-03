/**
 * Persistence for the two public forms, shared by the Express server and the
 * Vercel Functions.
 *
 * Uses node-postgres directly rather than the Drizzle client in lib/db, because
 * Vercel bundles functions from the repository root where workspace packages do
 * not resolve. The bootstrap DDL below mirrors lib/db/src/schema exactly: change
 * one and change the other. `pnpm --filter @workspace/db run push` stays the
 * canonical migration path.
 *
 * Without DATABASE_URL, entries are kept in memory and every response says so,
 * so a fresh deployment reports the truth instead of dropping a visitor.
 */

import pg, { type Pool as PoolType } from "pg";
import { sealHash, type ContactEntry, type SealedReceipt, type WaitlistEntry } from "./_core";

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS waitlist_requests (
  id serial PRIMARY KEY,
  email text NOT NULL,
  company text NOT NULL,
  agents text NOT NULL,
  frameworks jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  source text NOT NULL DEFAULT 'web',
  prev_hash text,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  topic text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

type Logger = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

const consoleLogger: Logger = {
  info: (o, m) => console.log(m ?? "", o),
  error: (o, m) => console.error(m ?? "", o),
};

let log: Logger = consoleLogger;

/** Lets the Express server route these logs through pino instead of console. */
export function setStoreLogger(logger: Logger) {
  log = logger;
}

let ready: Promise<PoolType | null> | null = null;

async function getPool(): Promise<PoolType | null> {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;

  if (!ready) {
    ready = (async () => {
      try {
        const pool = new pg.Pool({
          connectionString: url,
          max: 3,
          idleTimeoutMillis: 10_000,
          connectionTimeoutMillis: 5_000,
        });
        await pool.query(BOOTSTRAP);
        return pool;
      } catch (error) {
        log.error({ err: error }, "database unavailable, falling back to memory");
        return null;
      }
    })();
  }
  return ready;
}

const memoryWaitlist: SealedReceipt[] = [];
const memoryContact: { id: string; received: string }[] = [];

export async function saveWaitlist(entry: WaitlistEntry & { source?: string }): Promise<SealedReceipt> {
  const sealedAt = new Date().toISOString();
  const pool = await getPool();

  if (pool) {
    try {
      const previous = await pool.query<{ hash: string }>(
        "SELECT hash FROM waitlist_requests ORDER BY id DESC LIMIT 1",
      );
      const prevHash = previous.rows[0]?.hash ?? null;
      const hash = sealHash({ ...entry, sealedAt }, prevHash);

      const inserted = await pool.query<{ id: number; created_at: Date }>(
        `INSERT INTO waitlist_requests (email, company, agents, frameworks, note, source, prev_hash, hash)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [
          entry.email,
          entry.company,
          entry.agents,
          JSON.stringify(entry.frameworks ?? []),
          entry.note ?? null,
          entry.source ?? "web",
          prevHash,
          hash,
        ],
      );

      const row = inserted.rows[0];
      return {
        id: `wl_${String(row.id).padStart(6, "0")}`,
        sequence: row.id,
        hash,
        prevHash,
        sealedAt: row.created_at.toISOString(),
        stored: true,
      };
    } catch (error) {
      log.error({ err: error }, "waitlist insert failed, storing in memory");
    }
  }

  const prevHash = memoryWaitlist.at(-1)?.hash ?? null;
  const sequence = memoryWaitlist.length + 1;
  const receipt: SealedReceipt = {
    id: `wl_mem_${String(sequence).padStart(6, "0")}`,
    sequence,
    hash: sealHash({ ...entry, sealedAt }, prevHash),
    prevHash,
    sealedAt,
    stored: false,
  };
  memoryWaitlist.push(receipt);
  log.info({ company: entry.company, agents: entry.agents }, "waitlist request received");
  return receipt;
}

export async function saveContact(entry: ContactEntry): Promise<{ id: string; received: string }> {
  const received = new Date().toISOString();
  const pool = await getPool();

  if (pool) {
    try {
      const inserted = await pool.query<{ id: number; created_at: Date }>(
        `INSERT INTO contact_messages (name, email, topic, message)
         VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
        [entry.name, entry.email, entry.topic, entry.message],
      );
      const row = inserted.rows[0];
      return { id: `msg_${String(row.id).padStart(6, "0")}`, received: row.created_at.toISOString() };
    } catch (error) {
      log.error({ err: error }, "contact insert failed, storing in memory");
    }
  }

  const id = `msg_mem_${String(memoryContact.length + 1).padStart(6, "0")}`;
  memoryContact.push({ id, received });
  log.info({ topic: entry.topic }, "contact message received");
  return { id, received };
}

export async function counts(): Promise<{ waitlist: number; contact: number; durable: boolean }> {
  const pool = await getPool();
  if (pool) {
    try {
      const [waitlist, contact] = await Promise.all([
        pool.query<{ count: string }>("SELECT count(*)::text AS count FROM waitlist_requests"),
        pool.query<{ count: string }>("SELECT count(*)::text AS count FROM contact_messages"),
      ]);
      return {
        waitlist: Number(waitlist.rows[0].count),
        contact: Number(contact.rows[0].count),
        durable: true,
      };
    } catch (error) {
      log.error({ err: error }, "count query failed");
    }
  }
  return { waitlist: memoryWaitlist.length, contact: memoryContact.length, durable: false };
}
