import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devKeyProvider } from "./sign.ts";
import { jsonlStore } from "./store.ts";
import { readLedgerFeed, watchLedgerFeed, type FeedClock } from "./feed.ts";

const workspace = "feed-ws";

type FeedBody = {
  readonly workspace: string;
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly payload?: string;
};

async function seedLedger(count = 2): Promise<{ readonly file: string; readonly dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "void-feed-"));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(signer, { dir });
  for (let index = 1; index <= count; index += 1) {
    const body: FeedBody = {
      workspace,
      at: `2026-09-0${index}T00:00:00.000Z`,
      tool: `postgres.row.update.${index}`,
      klass: index === 1 ? "r1" : "r3",
      decision: index === 1 ? "allow:resolved" : "deny:resolved",
      argsDigest: `${index}`.repeat(64),
      args: { secret: "not for feed" },
      payload: "not for feed",
    };
    await store.append(body);
  }
  return { file: join(dir, `${workspace}.jsonl`), dir };
}

describe("readLedgerFeed", () => {
  test("returns the public feed shape without payloads or arguments", async () => {
    const { file } = await seedLedger();
    const page = await readLedgerFeed(file);
    assert.equal(page.verified, true);
    assert.equal(page.records.length, 2);
    assert.deepEqual(Object.keys(page.records[0]!).sort(), [
      "argsDigest",
      "at",
      "decision",
      "digest",
      "klass",
      "prevDigest",
      "seq",
      "tool",
    ].sort());
    assert.equal("args" in page.records[0]!, false);
    assert.equal("payload" in page.records[0]!, false);
    assert.equal(page.head, page.records[1]!.digest);
  });

  test("filters after seq only after verifying the full chain", async () => {
    const { file } = await seedLedger(3);
    const page = await readLedgerFeed(file, { afterSeq: 1 });
    assert.deepEqual(page.records.map((record) => record.seq), [2, 3]);
  });

  test("fails on a broken chain instead of returning partial data", async () => {
    const { file } = await seedLedger(2);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    const first = JSON.parse(lines[0]!) as { body: { tool: string } };
    first.body.tool = "tampered.tool";
    lines[0] = JSON.stringify(first);
    await writeFile(file, `${lines.join("\n")}\n`);
    await assert.rejects(() => readLedgerFeed(file), /body does not match digest/);
  });
});

describe("watchLedgerFeed", () => {
  test("emits the full verified page when the head changes", async () => {
    const { file, dir } = await seedLedger(1);
    const callbacks: Array<() => void> = [];
    const clock: FeedClock = {
      setInterval(callback) {
        callbacks.push(callback);
        return callback;
      },
      clearInterval() {},
    };
    const pages: unknown[] = [];
    const watcher = watchLedgerFeed(file, (page) => pages.push(page), { clock, pollMs: 1 });
    callbacks[0]!();
    await new Promise((resolve) => setImmediate(resolve));
    const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
    await jsonlStore(signer, { dir }).append({
      workspace,
      at: "2026-09-03T00:00:00.000Z",
      tool: "postgres.row.delete",
      klass: "r3",
      decision: "hold:denied",
      argsDigest: "a".repeat(64),
    });
    callbacks[0]!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    watcher.close();
    assert.equal((pages[pages.length - 1] as { records: readonly unknown[] }).records.length, 2);
  });
});
