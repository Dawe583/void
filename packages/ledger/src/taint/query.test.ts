import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  blastRadiusFromTaint,
  neighbors,
  pathToRoot,
} from "./query.ts";
import type { TaintGraph, TaintNode } from "./graph.ts";

const graph: TaintGraph = {
  nodes: new Map<string, TaintNode>([
    ["a", node(1, "a", "postgres.rows.select", "allow:resolved")],
    ["b", node(2, "b", "postgres.row.update", "allow:resolved")],
    ["c", node(3, "c", "sendgrid.mail.send", "hold:approved")],
    ["d", node(4, "d", "stripe.payout.create", "hold:denied")],
  ]),
  edges: [
    { from: "a", to: "b", kind: "resource", via: "postgres:orders:42" },
    { from: "b", to: "c", kind: "data", via: "result-2" },
  ],
};

describe("taint query", () => {
  test("neighbors returns linked nodes to depth one", () => {
    const result = neighbors(graph, "a", 1);
    assert.deepEqual(result.nodes.map((item) => item.seq), [1, 2]);
    assert.deepEqual(result.edges.map((item) => item.via), ["postgres:orders:42"]);
  });

  test("neighbors returns linked nodes to depth two", () => {
    const result = neighbors(graph, "a", 2);
    assert.deepEqual(result.nodes.map((item) => item.seq), [1, 2, 3]);
    assert.equal(result.edges.length, 2);
  });

  test("blast radius counts reachable distinct nodes only", () => {
    assert.equal(blastRadiusFromTaint(graph, "a"), 2);
    assert.equal(blastRadiusFromTaint(graph, "d"), 0);
  });

  test("pathToRoot returns the shortest evidence chain", () => {
    const result = pathToRoot(graph, "c");
    assert.deepEqual(result.nodes.map((item) => item.seq), [1, 2, 3]);
    assert.deepEqual(result.edges.map((item) => item.via), ["postgres:orders:42", "result-2"]);
  });
});

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
