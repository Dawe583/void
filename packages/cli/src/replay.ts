import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readLedgerFeed, type FeedPage, type LedgerFeedRecord } from "../../ledger/src/feed.ts";

export type SnapshotReference = {
  readonly namespace: string;
  readonly digest: `sha256:${string}`;
  readonly uri: string;
};

export type ConnectorCall = {
  readonly tool: string;
  readonly connector: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly workspace: string | undefined;
};

export type InverseStep = {
  readonly id: string;
  readonly target: string;
  readonly operation: string;
  readonly dependsOn: readonly string[];
  readonly inputDigest: `sha256:${string}`;
};

export type InversePlan = {
  readonly connector: string;
  readonly call: ConnectorCall;
  readonly capture: SnapshotReference;
  readonly steps: readonly InverseStep[];
  readonly facts: readonly unknown[];
};

export type DriftChange = {
  readonly target: string;
  readonly key: Readonly<Record<string, string>>;
  readonly field: string;
  readonly capturedDigest: `sha256:${string}`;
  readonly currentDigest: `sha256:${string}`;
};

export type ReplayRefusal = {
  readonly stepId: string;
  readonly reason: "drift" | "missing_target" | "permission_denied" | "internal_error";
  readonly changed: readonly DriftChange[];
};

export type ApplyReport = {
  readonly applied: readonly string[];
  readonly refused: readonly ReplayRefusal[];
};

export type ReplayConnector = {
  readonly id: string;
  readonly surface: string;
  readonly inverse: (capture: SnapshotReference) => Promise<InversePlan>;
  readonly apply: (plan: InversePlan) => Promise<ApplyReport>;
};

export type ReplayConnectorRegistry = Readonly<Record<string, ReplayConnector>>;

export type ReplayCommandIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
};

export type ReplayCommandOptions = {
  readonly readFeed?: typeof readLedgerFeed;
  readonly readManifest?: (snapshotDir: string) => Promise<readonly SnapshotManifestRecord[]>;
  readonly connectors?: ReplayConnectorRegistry;
};

export type SnapshotManifestRecord = {
  readonly digest: string;
  readonly reference: SnapshotReference;
  readonly tool: string;
};

type ReplayArgs = {
  readonly ledger: string;
  readonly snapshotDir: string;
  readonly seq: number;
  readonly dryRun: boolean;
};

const USAGE = "usage: void replay --ledger <path> --snapshot-dir <dir> --seq <n> [--dry-run]";

export async function runReplayCommand(
  argv: readonly string[],
  io: ReplayCommandIo,
  options: ReplayCommandOptions = {},
): Promise<number> {
  try {
    const parsed = await parseReplayArgs(argv, io.env ?? process.env);
    const page = await (options.readFeed ?? readLedgerFeed)(parsed.ledger);
    const record = findRecord(page, parsed.seq);
    const manifest = await (options.readManifest ?? readSnapshotManifest)(parsed.snapshotDir);
    const snapshot = findSnapshot(manifest, record);
    const connector = findConnector(options.connectors ?? {}, record.tool);
    const plan = await connector.inverse(snapshot.reference);

    printReplayHeader(record, snapshot, io.stdout);
    if (parsed.dryRun) {
      printPlan(plan, io.stdout);
      return 0;
    }

    const report = await connector.apply(plan);
    printApplyReport(report, io.stdout);
    return report.refused.length === 0 ? 0 : 1;
  } catch (error) {
    io.stderr(`void replay failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function parseReplayArgs(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv>): Promise<ReplayArgs> {
  let ledger: string | undefined;
  let snapshotDir: string | undefined;
  let seq: number | undefined;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--ledger") {
      ledger = needValue(argv, index, "--ledger");
      index += 1;
    } else if (arg === "--snapshot-dir") {
      snapshotDir = needValue(argv, index, "--snapshot-dir");
      index += 1;
    } else if (arg === "--seq") {
      const raw = needValue(argv, index, "--seq");
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) throw new Error("--seq needs a positive integer");
      seq = value;
      index += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`unknown replay option ${JSON.stringify(arg)}. ${USAGE}`);
    }
  }
  if (seq === undefined) throw new Error(USAGE);
  if (snapshotDir === undefined) throw new Error(USAGE);
  return { ledger: await resolveLedgerPath(ledger, env), snapshotDir, seq, dryRun };
}

function needValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value === "") throw new Error(`${name} needs a value`);
  return value;
}

async function resolveLedgerPath(ledger: string | undefined, env: Readonly<NodeJS.ProcessEnv>): Promise<string> {
  const path = ledger ?? join(env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger"), `${env.VOID_WORKSPACE ?? "default"}.jsonl`);
  try {
    const info = await stat(path);
    if (info.isDirectory()) return join(path, `${env.VOID_WORKSPACE ?? "default"}.jsonl`);
  } catch {
    return path;
  }
  return path;
}

function findRecord(page: FeedPage, seq: number): LedgerFeedRecord {
  if (page.verified !== true) throw new Error("ledger chain was not verified");
  const record = page.records.find((candidate) => candidate.seq === seq);
  if (record === undefined) throw new Error(`ledger has no entry with seq ${seq}`);
  return record;
}

async function readSnapshotManifest(snapshotDir: string): Promise<readonly SnapshotManifestRecord[]> {
  const text = await readFile(join(snapshotDir, "manifest.jsonl"), "utf8");
  const records: SnapshotManifestRecord[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`manifest line ${index + 1} is not JSON`);
    }
    records.push(asManifestRecord(parsed, index + 1));
  }
  return records;
}

function asManifestRecord(value: unknown, line: number): SnapshotManifestRecord {
  if (typeof value !== "object" || value === null)
    throw new Error(`manifest line ${line} is not an object`);
  const record = value as Partial<SnapshotManifestRecord>;
  if (typeof record.digest !== "string" || record.digest === "")
    throw new Error(`manifest line ${line} has no digest`);
  if (typeof record.tool !== "string" || record.tool === "")
    throw new Error(`manifest line ${line} has no tool`);
  if (typeof record.reference !== "object" || record.reference === null)
    throw new Error(`manifest line ${line} has no reference`);
  const reference = record.reference as Partial<SnapshotReference>;
  if (typeof reference.namespace !== "string" || reference.namespace === "")
    throw new Error(`manifest line ${line} reference has no namespace`);
  if (typeof reference.digest !== "string" || !reference.digest.startsWith("sha256:"))
    throw new Error(`manifest line ${line} reference has invalid digest`);
  if (typeof reference.uri !== "string" || reference.uri === "")
    throw new Error(`manifest line ${line} reference has no uri`);
  return { digest: record.digest, tool: record.tool, reference: reference as SnapshotReference };
}

function findSnapshot(
  manifest: readonly SnapshotManifestRecord[],
  record: LedgerFeedRecord,
): SnapshotManifestRecord {
  const snapshot = manifest.find(
    (candidate) => candidate.digest === record.argsDigest && candidate.tool === record.tool,
  );
  if (snapshot === undefined)
    throw new Error(`no snapshot manifest match for seq ${record.seq}, tool ${record.tool}, argsDigest ${record.argsDigest}`);
  return snapshot;
}

function findConnector(registry: ReplayConnectorRegistry, tool: string): ReplayConnector {
  const candidates = Object.values(registry);
  const connector = candidates.find((candidate) => tool.startsWith(`${candidate.surface}.`))
    ?? candidates.find((candidate) => tool.split(".").includes(candidate.id))
    ?? registry[tool.split(".")[0] ?? ""];
  if (connector === undefined) throw new Error(`no connector for tool vendor ${toolVendor(tool)}`);
  return connector;
}

function toolVendor(tool: string): string {
  const [first, second] = tool.split(".");
  return first === "aws" && second === "s3" ? "s3" : first ?? tool;
}

function printReplayHeader(
  record: LedgerFeedRecord,
  snapshot: SnapshotManifestRecord,
  stdout: (line: string) => void,
): void {
  stdout(`seq: ${record.seq}`);
  stdout(`tool: ${record.tool}`);
  stdout(`argsDigest: ${record.argsDigest}`);
  stdout(`snapshot: ${snapshot.reference.uri}`);
}

function printPlan(plan: InversePlan, stdout: (line: string) => void): void {
  stdout(`inverse plan: ${plan.connector}`);
  for (const step of plan.steps) {
    const dependsOn = step.dependsOn.length === 0 ? "none" : step.dependsOn.join(",");
    stdout(`step ${step.id}: ${step.operation} ${step.target} inputDigest ${step.inputDigest} dependsOn ${dependsOn}`);
  }
}

function printApplyReport(report: ApplyReport, stdout: (line: string) => void): void {
  stdout(`applied: ${report.applied.length === 0 ? "none" : report.applied.join(",")}`);
  for (const refusal of report.refused) {
    stdout(`refused ${refusal.stepId}: ${refusal.reason}`);
    for (const change of refusal.changed) {
      stdout(`drift ${change.target} ${JSON.stringify(change.key)} ${change.field} ${change.capturedDigest} -> ${change.currentDigest}`);
    }
  }
}
