import type { JsonlEntry } from "../store.ts";

export type CallDigest = string;

export type TaintNode = {
  readonly digest: CallDigest;
  readonly seq: number;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly at: string;
};

export type TaintEdge = {
  readonly from: CallDigest;
  readonly to: CallDigest;
  readonly kind: "resource" | "data";
  readonly via: string;
};

export type TaintGraph = {
  readonly nodes: Map<CallDigest, TaintNode>;
  readonly edges: readonly TaintEdge[];
};

export const DATA_EDGE_HONESTY_NOTE =
  "Data edges require outputDigest on the producing ledger entry. Entries without outputDigest produce resource edges only.";

export function buildGraph(entries: readonly JsonlEntry[]): TaintGraph {
  const nodes = new Map<CallDigest, TaintNode>();
  const edges: TaintEdge[] = [];
  const edgeKeys = new Set<string>();
  const lastByResource = new Map<string, CallDigest>();
  const producerByOutput = new Map<string, CallDigest>();

  for (const entry of entries) {
    const body = entryBody(entry);
    const digest = requiredString(entry.hash, "entry hash", entry.seq);
    const node: TaintNode = {
      digest,
      seq: entry.seq,
      tool: requiredString(body.tool, "tool", entry.seq),
      klass: requiredString(body.klass, "klass", entry.seq),
      decision: requiredString(body.decision, "decision", entry.seq),
      at: requiredString(body.at, "at", entry.seq),
    };
    nodes.set(digest, node);

    for (const inputDigest of inputDigests(body)) {
      const from = producerByOutput.get(inputDigest);
      if (from !== undefined) addEdge(edges, edgeKeys, from, digest, "data", inputDigest);
    }

    for (const resource of resourceKeys(body, node.tool)) {
      const from = lastByResource.get(resource);
      if (from !== undefined) addEdge(edges, edgeKeys, from, digest, "resource", resource);
      lastByResource.set(resource, digest);
    }

    const outputDigest = stringValue(body.outputDigest);
    if (outputDigest !== undefined) producerByOutput.set(outputDigest, digest);
  }

  return { nodes, edges };
}

function addEdge(
  edges: TaintEdge[],
  edgeKeys: Set<string>,
  from: CallDigest,
  to: CallDigest,
  kind: TaintEdge["kind"],
  via: string,
): void {
  if (from === to) return;
  const key = `${from}\0${to}\0${kind}\0${via}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ from, to, kind, via });
}

function entryBody(entry: JsonlEntry): Record<string, unknown> {
  if (typeof entry.body !== "object" || entry.body === null) {
    throw new Error(`ledger entry ${entry.seq} has invalid body`);
  }
  return entry.body as Record<string, unknown>;
}

function requiredString(value: unknown, name: string, seq: number): string {
  if (typeof value !== "string" || value === "") throw new Error(`ledger entry ${seq} has no ${name}`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sourceArgs(body: Record<string, unknown>): Record<string, unknown> {
  return typeof body.args === "object" && body.args !== null
    ? body.args as Record<string, unknown>
    : body;
}

function resourceKeys(body: Record<string, unknown>, tool: string): string[] {
  const args = sourceArgs(body);
  const keys: string[] = [];
  const bucket = firstString(args, ["bucket", "Bucket", "bucketName"]);
  const key = firstString(args, ["key", "Key", "objectKey"]);
  if (bucket !== undefined && key !== undefined) keys.push(`${tool}:bucket=${bucket}:key=${key}`);

  const table = firstString(args, ["table", "tableName", "relation"]);
  const rowDigest = firstString(args, ["rowPredicateDigest", "predicateDigest", "whereDigest", "queryDigest"]);
  if (table !== undefined && rowDigest !== undefined) keys.push(`${tool}:table=${table}:predicate=${rowDigest}`);

  const identity = firstString(args, ["resourceKey", "resourceId", "identity", "target", "id"]);
  if (identity !== undefined) keys.push(`${tool}:identity=${identity}`);

  if (keys.length === 0) {
    const argsDigest = stringValue(body.argsDigest);
    if (argsDigest !== undefined) keys.push(`${tool}:argsDigest=${argsDigest}`);
  }

  return keys;
}

function firstString(source: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = stringValue(source[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function inputDigests(body: Record<string, unknown>): string[] {
  const found = new Set<string>();
  collectNamedDigests(body.inputDigest, found);
  collectNamedDigests(body.inputDigests, found);
  collectStrings(sourceArgs(body), found);
  return [...found];
}

function collectNamedDigests(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedDigests(item, found);
    return;
  }
  const digest = stringValue(value);
  if (digest !== undefined) found.add(digest);
}

function collectStrings(value: unknown, found: Set<string>): void {
  if (typeof value === "string") {
    if (value !== "") found.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, found);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, found);
  }
}
