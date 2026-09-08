import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { buildGraph, DATA_EDGE_HONESTY_NOTE } from "./graph.ts";
import { exportTaint } from "./capture.ts";
import type { JsonlEntry } from "../store.ts";

function entry(seq: number, body: Record<string, unknown>): JsonlEntry {
  const hash = `${seq}`.repeat(64).slice(0, 64);
  return {
    workspace: "taint-test",
    seq,
    body: {
      workspace: "taint-test",
      at: `2026-09-0${seq}T00:00:00.000Z`,
      klass: "r1",
      decision: "allow:resolved",
      argsDigest: `${seq + 1}`.repeat(64).slice(0, 64),
      ...body,
    },
    prev_hash: `${seq - 1}`.repeat(64).slice(0, 64),
    hash,
    key_id: "test-key",
    alg: "ed25519",
    signature: "ed25519:test",
  };
}

describe("buildGraph", () => {
  test("links two deletes on the same bucket and key", () => {
    const entries = [
      entry(1, { tool: "s3.object.delete", args: { bucket: "docs", key: "a.txt" } }),
      entry(2, { tool: "s3.object.delete", args: { bucket: "docs", key: "a.txt" } }),
    ];

    const graph = buildGraph(entries);

    assert.equal(graph.nodes.size, 2);
    assert.deepEqual(graph.edges, [
      {
        from: entries[0]!.hash,
        to: entries[1]!.hash,
        kind: "resource",
        via: "s3.object.delete:bucket=docs:key=a.txt",
      },
    ]);
  });

  test("does not link different object keys", () => {
    const graph = buildGraph([
      entry(1, { tool: "s3.object.delete", args: { bucket: "docs", key: "a.txt" } }),
      entry(2, { tool: "s3.object.delete", args: { bucket: "docs", key: "b.txt" } }),
    ]);

    assert.deepEqual(graph.edges, []);
  });

  test("skips data edges without outputDigest and exports the honesty note", () => {
    const graph = buildGraph([
      entry(1, { tool: "postgres.row.select", args: { table: "orders", rowPredicateDigest: "where-1" } }),
      entry(2, { tool: "stripe.payout.create", args: { source: "where-1" } }),
    ]);

    assert.equal(graph.edges.some((edge) => edge.kind === "data"), false);
    assert.equal(exportTaint(graph).includes(DATA_EDGE_HONESTY_NOTE), true);
  });

  test("links outputDigest to a later input when the ledger carries it", () => {
    const graph = buildGraph([
      entry(1, { tool: "postgres.row.select", args: { table: "orders", rowPredicateDigest: "where-1" }, outputDigest: "result-1" }),
      entry(2, { tool: "stripe.payout.create", args: { source: "result-1" } }),
    ]);

    assert.equal(graph.edges.some((edge) => edge.kind === "data" && edge.via === "result-1"), true);
  });
});
