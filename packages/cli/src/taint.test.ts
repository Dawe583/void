import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTaintCommand, type TaintCommandOptions } from "./taint.ts";
import type { FeedPage } from "../../ledger/src/feed.ts";
import type { TaintGraph, TaintNode } from "../../ledger/src/taint/graph.ts";

const page: FeedPage = {
  verified: true,
  head: "c".repeat(64),
  records: [
    record(1, "a", "postgres.rows.select", "allow:resolved"),
    record(2, "b", "postgres.row.update", "allow:resolved"),
    record(3, "c", "sendgrid.mail.send", "hold:approved"),
  ],
};

const graph: TaintGraph = {
  nodes: new Map<string, TaintNode>([
    ["a", node(1, "a", "postgres.rows.select", "allow:resolved")],
    ["b", node(2, "b", "postgres.row.update", "allow:resolved")],
    ["c", node(3, "c", "sendgrid.mail.send", "hold:approved")],
  ]),
  edges: [
    { from: "a", to: "b", kind: "resource", via: "postgres:orders:42" },
    { from: "b", to: "c", kind: "data", via: "result-2" },
  ],
};

describe("runTaintCommand", () => {
  test("prints node rows and edge reasons", async () => {
    const ledger = await ledgerFile();
    const out: string[] = [];
    const err: string[] = [];
    const code = await runTaintCommand(["--ledger", ledger, "--seq", "1", "--depth", "1"], {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    }, options());

    assert.equal(code, 0);
    assert.equal(err.length, 0);
    assert.match(out.join("\n"), /seq tool decision digest/);
    assert.match(out.join("\n"), /1 postgres\.rows\.select allow:resolved a/);
    assert.match(out.join("\n"), /2 postgres\.row\.update allow:resolved b/);
    assert.doesNotMatch(out.join("\n"), /sendgrid/);
    assert.match(out.join("\n"), /1 -> 2 resource postgres:orders:42/);
  });

  test("json emits the exported taint shape for the neighborhood", async () => {
    const ledger = await ledgerFile();
    const out: string[] = [];
    const code = await runTaintCommand(["--ledger", ledger, "--seq", "1", "--depth", "1", "--json"], {
      stdout: (line) => out.push(line),
      stderr: () => {},
    }, options());

    assert.equal(code, 0);
    const exported = JSON.parse(out[0]!) as { version: string; nodes: TaintNode[]; edges: unknown[] };
    assert.equal(exported.version, "void.taint.v1");
    assert.deepEqual(exported.nodes.map((item) => item.seq), [1, 2]);
    assert.equal(exported.edges.length, 1);
  });

  test("a missing seq exits one", async () => {
    const ledger = await ledgerFile();
    const err: string[] = [];
    const code = await runTaintCommand(["--ledger", ledger, "--seq", "9"], {
      stdout: () => {},
      stderr: (line) => err.push(line),
    }, options());

    assert.equal(code, 1);
    assert.match(err.join("\n"), /ledger has no entry with seq 9/);
  });

  test("a chain verification failure exits one before graph loading", async () => {
    const ledger = await ledgerFile();
    const err: string[] = [];
    let loaded = false;
    const code = await runTaintCommand(["--ledger", ledger, "--seq", "1"], {
      stdout: () => {},
      stderr: (line) => err.push(line),
    }, {
      readFeed: async () => {
        throw new Error("ledger chain invalid: entry 1 body does not match digest");
      },
      loadGraph: async () => {
        loaded = true;
        return graph;
      },
    });

    assert.equal(code, 1);
    assert.equal(loaded, false);
    assert.match(err.join("\n"), /ledger chain invalid/);
  });

  test("a missing ledger dir exits one", async () => {
    const err: string[] = [];
    const code = await runTaintCommand(["--ledger", join(tmpdir(), "void-missing-taint-ledger"), "--seq", "1"], {
      stdout: () => {},
      stderr: (line) => err.push(line),
    }, options());

    assert.equal(code, 1);
    assert.match(err.join("\n"), /ledger dir missing/);
  });
});

function options(): TaintCommandOptions {
  return {
    readFeed: async () => page,
    loadGraph: async () => graph,
  };
}

function record(seq: number, digest: string, tool: string, decision: string) {
  return {
    seq,
    at: "2026-09-01T00:00:00.000Z",
    tool,
    klass: "r1",
    decision,
    argsDigest: "sha256:" + digest.repeat(64).slice(0, 64),
    prevDigest: "0".repeat(64),
    digest,
  };
}

function node(seq: number, digest: string, tool: string, decision: string): TaintNode {
  return {
    seq,
    digest,
    tool,
    decision,
    klass: "r1",
    at: "2026-09-01T00:00:00.000Z",
  };
}

async function ledgerFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "void-taint-cli-"));
  const file = join(dir, "default.jsonl");
  await writeFile(file, "");
  return file;
}
