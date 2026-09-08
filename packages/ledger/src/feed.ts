import { watchFile, unwatchFile } from "node:fs";
import type { JsonlEntry } from "./store.ts";
import { readLedgerEntries, verifyChain } from "./verify.ts";

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
  const entries = await readLedgerEntries(ledgerPath);
  const result = await verifyChain(entries);
  if (!result.ok) throw new Error(`ledger chain invalid: ${result.reason}`);
  const records = entries
    .filter((entry) => entry.seq > (options.afterSeq ?? 0))
    .map((entry) => toFeedRecord(entry));

  return { records, verified: true, head: result.head };
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

