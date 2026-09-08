import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readLedgerFeed } from "../feed.ts";
import type { JsonlEntry } from "../store.ts";
import { buildGraph, DATA_EDGE_HONESTY_NOTE, type TaintEdge, type TaintGraph, type TaintNode } from "./graph.ts";

export type ExportedTaint = {
  readonly version: "void.taint.v1";
  readonly honesty: {
    readonly dataEdges: typeof DATA_EDGE_HONESTY_NOTE;
  };
  readonly nodes: readonly TaintNode[];
  readonly edges: readonly TaintEdge[];
};

export async function taintFromLedger(dir: string, workspace: string): Promise<TaintGraph> {
  const ledgerPath = join(dir, `${workspace}.jsonl`);
  await readLedgerFeed(ledgerPath);
  return buildGraph(await readEntries(ledgerPath));
}

export function exportTaint(graph: TaintGraph): string {
  const exported: ExportedTaint = {
    version: "void.taint.v1",
    honesty: { dataEdges: DATA_EDGE_HONESTY_NOTE },
    nodes: [...graph.nodes.values()].sort((left, right) => left.seq - right.seq),
    edges: [...graph.edges].sort(compareEdges),
  };
  return JSON.stringify(exported);
}

export function verifyTaint(json: string): TaintGraph {
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== "object" || parsed === null) throw new Error("taint export is not an object");
  const value = parsed as Partial<ExportedTaint>;
  if (value.version !== "void.taint.v1") throw new Error("taint export has invalid version");
  if (value.honesty?.dataEdges !== DATA_EDGE_HONESTY_NOTE) throw new Error("taint export has invalid honesty note");
  if (!Array.isArray(value.nodes)) throw new Error("taint export has invalid nodes");
  if (!Array.isArray(value.edges)) throw new Error("taint export has invalid edges");

  const nodes = new Map<string, TaintNode>();
  for (const node of value.nodes) {
    const parsedNode = parseNode(node);
    if (nodes.has(parsedNode.digest)) throw new Error(`taint export duplicates node ${parsedNode.digest}`);
    nodes.set(parsedNode.digest, parsedNode);
  }

  const edges = value.edges.map((edge) => parseEdge(edge, nodes));
  return { nodes, edges };
}

async function readEntries(ledgerPath: string): Promise<JsonlEntry[]> {
  const text = await readFile(ledgerPath, "utf8");
  const entries: JsonlEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error(`ledger line ${index + 1} is not an object`);
    entries.push(parsed as JsonlEntry);
  }
  return entries;
}

function parseNode(value: unknown): TaintNode {
  if (typeof value !== "object" || value === null) throw new Error("taint export node is not an object");
  const node = value as Partial<TaintNode>;
  return {
    digest: requiredString(node.digest, "node digest"),
    seq: requiredInteger(node.seq, "node seq"),
    tool: requiredString(node.tool, "node tool"),
    klass: requiredString(node.klass, "node klass"),
    decision: requiredString(node.decision, "node decision"),
    at: requiredString(node.at, "node at"),
  };
}

function parseEdge(value: unknown, nodes: ReadonlyMap<string, TaintNode>): TaintEdge {
  if (typeof value !== "object" || value === null) throw new Error("taint export edge is not an object");
  const edge = value as Partial<TaintEdge>;
  const from = requiredString(edge.from, "edge from");
  const to = requiredString(edge.to, "edge to");
  if (!nodes.has(from)) throw new Error(`taint export edge references unknown from node ${from}`);
  if (!nodes.has(to)) throw new Error(`taint export edge references unknown to node ${to}`);
  const kind = edge.kind;
  if (kind !== "resource" && kind !== "data") throw new Error("taint export edge has invalid kind");
  return { from, to, kind, via: requiredString(edge.via, "edge via") };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`taint export has invalid ${name}`);
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`taint export has invalid ${name}`);
  return value;
}

function compareEdges(left: TaintEdge, right: TaintEdge): number {
  return compare(left.from, right.from) || compare(left.to, right.to) || compare(left.kind, right.kind) || compare(left.via, right.via);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
