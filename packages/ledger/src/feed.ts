import { watchFile, unwatchFile } from "node:fs";
import { readFile } from "node:fs/promises";

import { GENESIS_PREV, entryHash } from "./canonical.ts";
import { sha256Hex } from "./sign.ts";
import type { JsonlEntry } from "./store.ts";

export type LedgerFeedRecord = {
  readonly seq: number;
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
  readonly prevDigest: string;
  readonly digest: string;
};

export type FeedPage = {
  readonly records: readonly LedgerFeedRecord[];
  readonly verified: true;
  readonly head: string;
};

export type FeedClock = {
  readonly setInterval: (callback: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

export type WatchLedgerFeedOptions = {
  readonly pollMs?: number;
  readonly clock?: FeedClock;
};

export type LedgerFeedWatch = {
  close(): void;
};

const DEFAULT_POLL_MS = 500;

export async function readLedgerFeed(
  ledgerPath: string,
  options: { readonly afterSeq?: number } = {},
): Promise<FeedPage> {
  const entries = await readEntries(ledgerPath);
  const records: LedgerFeedRecord[] = [];
  let prev = GENESIS_PREV;
  let checked = 0;

  for (const entry of entries) {
    checked += 1;
    if (entry.seq !== checked)
      throw new Error(`ledger chain invalid: expected seq ${checked}, found ${entry.seq}`);
    if (entry.prev_hash !== prev)
      throw new Error(`ledger chain invalid: entry ${entry.seq} points at ${entry.prev_hash}, expected ${prev}`);
    const recomputed = await entryHash(entry.body, prev, sha256Hex);
    if (recomputed !== entry.hash)
      throw new Error(`ledger chain invalid: entry ${entry.seq} body does not match digest`);

    if (entry.seq > (options.afterSeq ?? 0)) {
      records.push(toFeedRecord(entry));
    }
    prev = entry.hash;
  }

  return { records, verified: true, head: prev };
}

export function watchLedgerFeed(
  ledgerPath: string,
  onChange: (page: FeedPage) => void,
  options: WatchLedgerFeedOptions = {},
): LedgerFeedWatch {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  let closed = false;
  let running = false;
  let lastHead: string | undefined;

  const tick = (): void => {
    if (closed || running) return;
    running = true;
    void readLedgerFeed(ledgerPath)
      .then((page) => {
        if (closed) return;
        if (page.head !== lastHead) onChange(page);
        lastHead = page.head;
      })
      .finally(() => {
        running = false;
      });
  };

  if (options.clock !== undefined) {
    const handle = options.clock.setInterval(tick, pollMs);
    return {
      close() {
        closed = true;
        options.clock!.clearInterval(handle);
      },
    };
  }

  watchFile(ledgerPath, { interval: pollMs }, tick);
  return {
    close() {
      closed = true;
      unwatchFile(ledgerPath, tick);
    },
  };
}

async function readEntries(ledgerPath: string): Promise<JsonlEntry[]> {
  const text = await readFile(ledgerPath, "utf8");
  const entries: JsonlEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`ledger line ${index + 1} is not JSON`);
    }
    entries.push(asEntry(parsed, index + 1));
  }
  return entries;
}

function asEntry(value: unknown, line: number): JsonlEntry {
  if (typeof value !== "object" || value === null)
    throw new Error(`ledger line ${line} is not an object`);
  const entry = value as Partial<JsonlEntry>;
  if (typeof entry.seq !== "number" || !Number.isInteger(entry.seq) || entry.seq < 1)
    throw new Error(`ledger line ${line} has invalid seq`);
  if (typeof entry.body !== "object" || entry.body === null)
    throw new Error(`ledger line ${line} has invalid body`);
  if (typeof entry.prev_hash !== "string" || typeof entry.hash !== "string")
    throw new Error(`ledger line ${line} has invalid chain digests`);
  return entry as JsonlEntry;
}

function toFeedRecord(entry: JsonlEntry): LedgerFeedRecord {
  const body = entry.body as Record<string, unknown>;
  const at = stringField(body, "at", entry.seq);
  const tool = stringField(body, "tool", entry.seq);
  const klass = stringField(body, "klass", entry.seq);
  const decision = stringField(body, "decision", entry.seq);
  const argsDigest = stringField(body, "argsDigest", entry.seq);
  return {
    seq: entry.seq,
    at,
    tool,
    klass,
    decision,
    argsDigest,
    prevDigest: entry.prev_hash,
    digest: entry.hash,
  };
}

function stringField(body: Record<string, unknown>, name: string, seq: number): string {
  const value = body[name];
  if (typeof value !== "string" || value === "")
    throw new Error(`ledger entry ${seq} has no ${name}`);
  return value;
}

