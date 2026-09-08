import type { TaintEdge, TaintGraph, TaintNode } from "./graph.ts";

export type TaintNeighborhood = {
  readonly nodes: readonly TaintNode[];
  readonly edges: readonly TaintEdge[];
};

export function neighbors(
  graph: TaintGraph,
  digest: string,
  depth: number,
): TaintNeighborhood {
  if (!Number.isInteger(depth) || depth < 0) throw new Error("taint depth must be a non-negative integer");
  if (!graph.nodes.has(digest)) return { nodes: [], edges: [] };

  const outgoing = outgoingEdges(graph.edges);
  const queued: Array<{ readonly digest: string; readonly depth: number }> = [
    { digest, depth: 0 },
  ];
  const seen = new Set<string>([digest]);
  const includedEdges: TaintEdge[] = [];

  for (let index = 0; index < queued.length; index += 1) {
    const current = queued[index]!;
    if (current.depth >= depth) continue;
    for (const edge of outgoing.get(current.digest) ?? []) {
      if (!graph.nodes.has(edge.to)) continue;
      includedEdges.push(edge);
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queued.push({ digest: edge.to, depth: current.depth + 1 });
    }
  }

  return {
    nodes: orderedNodes(graph.nodes, seen),
    edges: includedEdges,
  };
}

export function blastRadiusFromTaint(graph: TaintGraph, digest: string): number {
  if (!graph.nodes.has(digest)) return 0;

  const outgoing = outgoingEdges(graph.edges);
  const queued = [digest];
  const seen = new Set<string>([digest]);
  for (let index = 0; index < queued.length; index += 1) {
    const current = queued[index]!;
    for (const edge of outgoing.get(current) ?? []) {
      if (!graph.nodes.has(edge.to) || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queued.push(edge.to);
    }
  }
  return seen.size - 1;
}

export function pathToRoot(graph: TaintGraph, digest: string): TaintNeighborhood {
  const target = graph.nodes.get(digest);
  if (target === undefined) return { nodes: [], edges: [] };

  const incoming = incomingEdges(graph.edges);
  const queued: Array<{ readonly digest: string; readonly edges: readonly TaintEdge[] }> = [
    { digest, edges: [] },
  ];
  const seen = new Set<string>([digest]);

  for (let index = 0; index < queued.length; index += 1) {
    const current = queued[index]!;
    const parents = incoming.get(current.digest) ?? [];
    if (parents.length === 0) return pathFromEdges(graph, digest, current.edges);
    for (const edge of parents) {
      if (!graph.nodes.has(edge.from) || seen.has(edge.from)) continue;
      seen.add(edge.from);
      queued.push({ digest: edge.from, edges: [edge, ...current.edges] });
    }
  }

  return { nodes: [target], edges: [] };
}

function outgoingEdges(edges: readonly TaintEdge[]): Map<string, TaintEdge[]> {
  const outgoing = new Map<string, TaintEdge[]>();
  for (const edge of edges) {
    const bucket = outgoing.get(edge.from) ?? [];
    bucket.push(edge);
    outgoing.set(edge.from, bucket);
  }
  return outgoing;
}

function incomingEdges(edges: readonly TaintEdge[]): Map<string, TaintEdge[]> {
  const incoming = new Map<string, TaintEdge[]>();
  for (const edge of edges) {
    const bucket = incoming.get(edge.to) ?? [];
    bucket.push(edge);
    incoming.set(edge.to, bucket);
  }
  return incoming;
}

function orderedNodes(nodes: ReadonlyMap<string, TaintNode>, seen: ReadonlySet<string>): readonly TaintNode[] {
  return [...nodes.values()].filter((node) => seen.has(node.digest));
}

function pathFromEdges(
  graph: TaintGraph,
  digest: string,
  edges: readonly TaintEdge[],
): TaintNeighborhood {
  const node = graph.nodes.get(digest);
  if (edges.length === 0) return { nodes: node === undefined ? [] : [node], edges };
  const digests = [edges[0]!.from, ...edges.map((edge) => edge.to)];
  return {
    nodes: digests
      .map((value) => graph.nodes.get(value))
      .filter((value): value is TaintNode => value !== undefined),
    edges,
  };
}
