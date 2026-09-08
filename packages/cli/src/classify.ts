/**
 * The classify command, WP-04a: the class distribution over a transcript.
 *
 * It exists so a registry reviewer can see, without running a proxy, what
 * the current entries decide for a realistic session. An unclassified share
 * above the threshold is the number that tells the next migration batch
 * where coverage is thin, which is why it is printed first, not buried.
 */

import { registry, findEntry, evaluate, type RegistryTone } from "@void/registry";

export type TranscriptCall = {
  readonly tool: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly facts?: Readonly<Record<string, string | boolean | undefined>>;
};

export type ClassifyOutcome =
  | { readonly outcome: "classified"; readonly tone: RegistryTone }
  | { readonly outcome: "unknown-tool" }
  | { readonly outcome: "unclassified"; readonly assume: RegistryTone | null };

export type ClassifyReport = {
  readonly total: number;
  readonly distribution: Readonly<Record<RegistryTone | "unknown-tool" | "unclassified", number>>;
  readonly unclassifiedShare: number;
};

export function classifyCall(call: TranscriptCall): ClassifyOutcome {
  const entry = findEntry(call.tool);
  if (entry === undefined) return { outcome: "unknown-tool" };
  const result = evaluate(entry, {
    facts: call.facts ?? {},
    args: call.arguments ?? {},
  });
  if (result.outcome === "classified") return { outcome: "classified", tone: result.tone };
  if (result.outcome === "unclassified") return { outcome: "unclassified", assume: result.assumeTone };
  // The entry was found above, so the evaluator cannot call it unknown;
  // the branch exists so the union narrows without a cast.
  return { outcome: "unknown-tool" };
}

/**
 * Declared facts come from the operator's configuration file and apply to the
 * whole transcript; a per-call fact of the same name wins, because the
 * interceptor's view at call time is fresher than the config.
 */
export function classifyTranscript(
  calls: readonly TranscriptCall[],
  declaredFacts: Readonly<Record<string, string | boolean>> = {},
): ClassifyReport {
  const distribution: Record<RegistryTone | "unknown-tool" | "unclassified", number> = {
    r0: 0,
    r1: 0,
    r2: 0,
    r3: 0,
    "unknown-tool": 0,
    unclassified: 0,
  };
  for (const call of calls) {
    const outcome = classifyCall({
      ...call,
      facts: { ...declaredFacts, ...call.facts },
    });
    if (outcome.outcome === "classified") distribution[outcome.tone] += 1;
    else distribution[outcome.outcome] += 1;
  }
  const total = calls.length;
  // The share is one decimal and rounds half up, so 1/6 reads 16.7 rather
  // than 16.66666, and the threshold check uses the rounded value the
  // operator reads, never a hidden more precise one.
  const unclassifiedShare =
    total === 0 ? 0 : Math.round((distribution.unclassified / total) * 1000) / 10;
  return { total, distribution, unclassifiedShare };
}

export function formatClassifyReport(report: ClassifyReport): string {
  const lines: string[] = [];
  lines.push(`calls: ${report.total}`);
  for (const key of ["r0", "r1", "r2", "r3", "unknown-tool", "unclassified"] as const) {
    lines.push(`${key}: ${report.distribution[key]}`);
  }
  lines.push(`unclassified: ${report.unclassifiedShare}%`);
  return lines.join("\n");
}

/**
 * Parses one JSON object per line. A blank line is skipped; anything else
 * is a load error naming the line number, because a half written file must
 * not quietly drop calls from the denominator.
 */
export function parseTranscript(text: string): TranscriptCall[] {
  const calls: TranscriptCall[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`transcript line ${index + 1} is not JSON`);
    }
    if (typeof parsed !== "object" || parsed === null)
      throw new Error(`transcript line ${index + 1} is not an object`);
    const record = parsed as Record<string, unknown>;
    if (typeof record.tool !== "string" || record.tool === "")
      throw new Error(`transcript line ${index + 1} has no tool name`);
    calls.push(record as unknown as TranscriptCall);
  }
  return calls;
}

// The registry must load at all for any of this to be meaningful, and the
// reference is also the cheapest guard against an empty data file sneaking
// through an otherwise green suite.
export const REGISTRY_SIZE = registry.length;


/**
 * The command line entry. Reads a transcript and an optional facts file,
 * prints the distribution, and returns the process exit code: 0 for a
 * report, 1 for a load error. A report the operator can act on is success
 * even when the share is high, because the share is the finding.
 */
export async function runClassifyCommand(
  argv: readonly string[],
  readFile: (path: string) => string,
  stdout: (line: string) => void,
): Promise<number> {
  const transcriptFlag = argv.indexOf("--transcript");
  if (transcriptFlag === -1)
    throw new Error("usage: void classify --transcript <file> [--facts <file>]");
  const transcriptPath = argv[transcriptFlag + 1];
  if (transcriptPath === undefined)
    throw new Error("usage: void classify --transcript <file> [--facts <file>]");

  const calls = parseTranscript(readFile(transcriptPath));
  let declaredFacts: Record<string, string | boolean> = {};
  const factsFlag = argv.indexOf("--facts");
  if (factsFlag !== -1) {
    const factsPath = argv[factsFlag + 1];
    if (factsPath === undefined)
      throw new Error("--facts needs a path");
    const parsed: unknown = JSON.parse(readFile(factsPath));
    if (typeof parsed !== "object" || parsed === null)
      throw new Error("facts file: must be an object");
    // The facts file is the plain values map, the same shape loadFacts
    // returns, so the operator's verified file and the CLI agree.
    declaredFacts = parsed as Record<string, string | boolean>;
  }
  const report = classifyTranscript(calls, declaredFacts);
  stdout(formatClassifyReport(report));
  return 0;
}
