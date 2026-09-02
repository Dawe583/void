import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Storage for the two forms on the marketing site.
 *
 * The site has to work the moment it is pointed at a domain, with or without a
 * database attached, so this module degrades on purpose: when DATABASE_URL is
 * absent it keeps entries in memory and says so in the response, instead of
 * failing the request and losing the visitor.
 */

export type WaitlistEntry = {
  email: string;
  company: string;
  agents: string;
  frameworks: string[];
  note?: string;
  source?: string;
};

export type ContactEntry = {
  name: string;
  email: string;
  topic: string;
  message: string;
};

export type SealedReceipt = {
  id: string;
  sequence: number;
  hash: string;
  prevHash: string | null;
  sealedAt: string;
  stored: boolean;
};

type DbModule = typeof import("@workspace/db");

let dbPromise: Promise<DbModule | null> | null = null;

/** Loads the database lazily so a missing DATABASE_URL never breaks boot. */
async function getDb(): Promise<DbModule | null> {
  if (!process.env["DATABASE_URL"]) return null;
  if (!dbPromise) {
    dbPromise = import("@workspace/db").catch((error: unknown) => {
      logger.warn({ err: error }, "database unavailable, falling back to memory");
      return null;
    });
  }
  return dbPromise;
}

/** Deterministic entry hash, linked to the previous entry, like the product ledger. */
export function sealHash(payload: unknown, prevHash: string | null): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  const digest = createHash("sha256")
    .update(`${prevHash ?? "genesis"}|${canonical}`)
    .digest("hex");
  return `0x${digest.slice(0, 4)}..${digest.slice(-4)}`;
}

const memoryWaitlist: (WaitlistEntry & SealedReceipt)[] = [];
const memoryContact: (ContactEntry & { id: string; received: string })[] = [];

export async function saveWaitlist(entry: WaitlistEntry): Promise<SealedReceipt> {
  const db = await getDb();
  const sealedAt = new Date().toISOString();

  if (db) {
    try {
      const [previous] = await db.db
        .select({ hash: db.waitlistRequests.hash })
        .from(db.waitlistRequests)
        .orderBy(desc(db.waitlistRequests.id))
        .limit(1);

      const prevHash = previous?.hash ?? null;
      const hash = sealHash({ ...entry, sealedAt }, prevHash);

      const [row] = await db.db
        .insert(db.waitlistRequests)
        .values({
          email: entry.email,
          company: entry.company,
          agents: entry.agents,
          frameworks: entry.frameworks,
          note: entry.note ?? null,
          source: entry.source ?? "web",
          prevHash,
          hash,
        })
        .returning({ id: db.waitlistRequests.id, createdAt: db.waitlistRequests.createdAt });

      return {
        id: `wl_${String(row.id).padStart(6, "0")}`,
        sequence: row.id,
        hash,
        prevHash,
        sealedAt: row.createdAt.toISOString(),
        stored: true,
      };
    } catch (error) {
      logger.error({ err: error }, "waitlist insert failed, storing in memory");
    }
  }

  const prevHash = memoryWaitlist.at(-1)?.hash ?? null;
  const sequence = memoryWaitlist.length + 1;
  const hash = sealHash({ ...entry, sealedAt }, prevHash);
  const receipt: SealedReceipt = {
    id: `wl_mem_${String(sequence).padStart(6, "0")}`,
    sequence,
    hash,
    prevHash,
    sealedAt,
    stored: false,
  };
  memoryWaitlist.push({ ...entry, ...receipt });
  logger.info({ company: entry.company, agents: entry.agents }, "waitlist request received");
  return receipt;
}

export async function saveContact(entry: ContactEntry): Promise<{ id: string; received: string }> {
  const db = await getDb();
  const received = new Date().toISOString();

  if (db) {
    try {
      const [row] = await db.db
        .insert(db.contactMessages)
        .values(entry)
        .returning({ id: db.contactMessages.id, createdAt: db.contactMessages.createdAt });
      return { id: `msg_${String(row.id).padStart(6, "0")}`, received: row.createdAt.toISOString() };
    } catch (error) {
      logger.error({ err: error }, "contact insert failed, storing in memory");
    }
  }

  const id = `msg_mem_${String(memoryContact.length + 1).padStart(6, "0")}`;
  memoryContact.push({ ...entry, id, received });
  logger.info({ topic: entry.topic }, "contact message received");
  return { id, received };
}

export async function counts(): Promise<{ waitlist: number; contact: number; durable: boolean }> {
  const db = await getDb();
  if (db) {
    try {
      const waitlist = await db.db.select({ id: db.waitlistRequests.id }).from(db.waitlistRequests);
      const contact = await db.db.select({ id: db.contactMessages.id }).from(db.contactMessages);
      return { waitlist: waitlist.length, contact: contact.length, durable: true };
    } catch (error) {
      logger.error({ err: error }, "count query failed");
    }
  }
  return { waitlist: memoryWaitlist.length, contact: memoryContact.length, durable: false };
}
