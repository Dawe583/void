import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { readLedgerFeed, type FeedPage, type LedgerFeedRecord } from "../../ledger/src/feed.ts";
import { exportTaint, taintFromLedger } from "../../ledger/src/taint/capture.ts";
import type { TaintGraph } from "../../ledger/src/taint/graph.ts";
import { neighbors, type TaintNeighborhood } from "../../ledger/src/taint/query.ts";

export type TaintCommandIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
};

export type TaintCommandOptions = {
  readonly readFeed?: typeof readLedgerFeed;
  readonly loadGraph?: (ledger: ResolvedLedger) => Promise<TaintGraph>;
  readonly exportGraph?: (graph: TaintGraph) => string | unknown;
};

type TaintArgs = {
  readonly ledger: ResolvedLedger;
  readonly seq: number;
  readonly depth: number;
  readonly json: boolean;
};

export type ResolvedLedger = {
  readonly path: string;
  readonly dir: string;
  readonly workspace: string;
};

const USAGE = "usage: void taint --ledger <dir> --seq <n> [--depth <n>] [--json]";

export async function runTaintCommand(
  argv: readonly string[],
  io: TaintCommandIo,
  options: TaintCommandOptions = {},
): Promise<number> {
  try {
    const parsed = await parseTaintArgs(argv, io.env ?? process.env);
    const readFeed = options.readFeed ?? readLedgerFeed;
    const page = await readFeed(parsed.ledger.path);
    const record = findRecord(page, parsed.seq);
    const graph = await (options.loadGraph ?? loadTaintGraph)(parsed.ledger);
    const neighborhood = neighbors(graph, record.digest, parsed.depth);
    if (neighborhood.nodes.length === 0) throw new Error(`taint graph has no node for seq ${record.seq}`);
    if (parsed.json) {
      printJson(neighborhood, io.stdout, options.exportGraph ?? exportTaintNeighborhood);
    } else {
      printNeighborhood(neighborhood, io.stdout);
    }
    return 0;
  } catch (error) {
    io.stderr(`void taint failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function parseTaintArgs(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv>): Promise<TaintArgs> {
  let ledger: string | undefined;
  let seq: number | undefined;
  let depth = 2;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--ledger") {
      ledger = needValue(argv, index, "--ledger");
      index += 1;
    } else if (arg === "--seq") {
      seq = positiveInteger(needValue(argv, index, "--seq"), "--seq");
      index += 1;
    } else if (arg === "--depth") {
      depth = nonNegativeInteger(needValue(argv, index, "--depth"), "--depth");
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown taint option ${JSON.stringify(arg)}. ${USAGE}`);
    }
  }
  if (ledger === undefined || seq === undefined) throw new Error(USAGE);
  return { ledger: await resolveLedgerPath(ledger, env), seq, depth, json };
}

function needValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value === "") throw new Error(`${name} needs a value`);
  return value;
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} needs a positive integer`);
  return value;
}

function nonNegativeInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a non-negative integer`);
  return value;
}

async function resolveLedgerPath(path: string, env: Readonly<NodeJS.ProcessEnv>): Promise<ResolvedLedger> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`ledger dir missing: ${path}`);
  }
  if (info.isDirectory()) {
    const workspace = env.VOID_WORKSPACE ?? "default";
    return { path: join(path, `${workspace}.jsonl`), dir: path, workspace };
  }
  const workspace = basename(path).endsWith(".jsonl") ? basename(path).slice(0, -6) : basename(path);
  return { path, dir: dirname(path), workspace };
}

function findRecord(page: FeedPage, seq: number): LedgerFeedRecord {
  if (page.verified !== true) throw new Error("ledger chain was not verified");
  const record = page.records.find((candidate) => candidate.seq === seq);
  if (record === undefined) throw new Error(`ledger has no entry with seq ${seq}`);
  return record;
}

async function loadTaintGraph(ledger: ResolvedLedger): Promise<TaintGraph> {
  return taintFromLedger(ledger.dir, ledger.workspace);
}

function printJson(
  neighborhood: TaintNeighborhood,
  stdout: (line: string) => void,
  exporter: (graph: TaintGraph) => string | unknown,
): void {
  const exported = exporter(neighborhoodToGraph(neighborhood));
  stdout(typeof exported === "string" ? exported : JSON.stringify(exported));
}

function exportTaintNeighborhood(graph: TaintGraph): string {
  return exportTaint(graph);
}

function neighborhoodToGraph(neighborhood: TaintNeighborhood): TaintGraph {
  return {
    nodes: new Map(neighborhood.nodes.map((node) => [node.digest, node])),
    edges: neighborhood.edges,
  };
}

function printNeighborhood(neighborhood: TaintNeighborhood, stdout: (line: string) => void): void {
  const byDigest = new Map(neighborhood.nodes.map((node) => [node.digest, node]));
  stdout("seq tool decision digest");
  for (const node of neighborhood.nodes) {
    stdout(`${node.seq} ${node.tool} ${node.decision} ${node.digest}`);
  }
  if (neighborhood.edges.length > 0) stdout("edges");
  for (const edge of neighborhood.edges) {
    const sourceSeq = String(byDigest.get(edge.from)?.seq ?? "?");
    const targetSeq = String(byDigest.get(edge.to)?.seq ?? "?");
    stdout(`${sourceSeq} -> ${targetSeq} ${edge.kind} ${edge.via}`);
  }
}
