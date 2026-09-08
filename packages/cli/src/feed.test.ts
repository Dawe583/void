import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { runFeedCommand, closeActiveFeedWatch } from "./feed.ts";
import type { FeedPage } from "../../ledger/src/feed.ts";

const firstPage: FeedPage = {
  verified: true,
  head: "b".repeat(64),
  records: [
    {
      seq: 1,
      at: "2026-09-01T00:00:00.000Z",
      tool: "postgres.row.update",
      klass: "r1",
      decision: "allow:resolved",
      argsDigest: "a".repeat(64),
      prevDigest: "0".repeat(64),
      digest: "b".repeat(64),
    },
  ],
};

const secondPage: FeedPage = {
  verified: true,
  head: "c".repeat(64),
  records: [
    ...firstPage.records,
    {
      seq: 2,
      at: "2026-09-01T00:01:00.000Z",
      tool: "postgres.row.delete",
      klass: "r3",
      decision: "hold:denied",
      argsDigest: "d".repeat(64),
      prevDigest: "b".repeat(64),
      digest: "c".repeat(64),
    },
  ],
};

describe("runFeedCommand", () => {
  test("prints a table without argument payloads", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runFeedCommand(["--ledger", "ledger.jsonl"], {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    }, {
      readFeed: async () => firstPage,
    });
    assert.equal(code, 0);
    assert.equal(err.length, 0);
    assert.match(out.join("\n"), /argsDigest/);
    assert.doesNotMatch(out.join("\n"), /secret|payload|arguments/);
  });

  test("prints the verified page as JSON", async () => {
    const out: string[] = [];
    const code = await runFeedCommand(["--ledger", "ledger.jsonl", "--json"], {
      stdout: (line) => out.push(line),
      stderr: () => {},
    }, {
      readFeed: async () => firstPage,
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out[0]!) as FeedPage, firstPage);
  });

  test("follow prints only records after the last printed seq", async () => {
    const out: string[] = [];
    let emit: ((page: FeedPage) => void) | undefined;
    const code = await runFeedCommand(["--ledger", "ledger.jsonl", "--follow", "--json"], {
      stdout: (line) => out.push(line),
      stderr: () => {},
    }, {
      readFeed: async () => firstPage,
      watchFeed: (_path, onChange) => {
        emit = onChange;
        return { close() {} };
      },
    });
    assert.equal(code, 0);
    emit!(secondPage);
    closeActiveFeedWatch();
    assert.equal(out.length, 2);
    assert.equal((JSON.parse(out[0]!) as { seq: number }).seq, 1);
    assert.equal((JSON.parse(out[1]!) as { seq: number }).seq, 2);
  });


  test("argument parse errors exit one instead of throwing", async () => {
    const err: string[] = [];
    const code = await runFeedCommand(["--unknown"], {
      stdout: () => {},
      stderr: (line) => err.push(line),
    });
    assert.equal(code, 1);
    assert.match(err.join("\n"), /unknown feed option/);
  });

  test("a missing or invalid ledger exits one with a loud error", async () => {
    const err: string[] = [];
    const code = await runFeedCommand(["--ledger", "missing.jsonl"], {
      stdout: () => {},
      stderr: (line) => err.push(line),
    }, {
      readFeed: async () => {
        throw new Error("ENOENT missing.jsonl");
      },
    });
    assert.equal(code, 1);
    assert.match(err.join("\n"), /void feed failed: ENOENT/);
  });
});
