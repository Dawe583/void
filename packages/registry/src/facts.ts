/**
 * Declared facts, WP-04a. The configuration half of the evaluator: the
 * operator states what is true about the target (versioning is on, this
 * is a test account), the registry's cases ask about those facts, and the
 * policy holds whenever a case cannot decide because a fact is missing.
 *
 * The package imports nothing: parsing a file is the caller's job, and
 * staleness is a warning the report carries, never a silent denial,
 * because a fact that went stale is information, not an outage.
 */

import type { EvaluationContext } from "./evaluate.ts";

export type FactValue = string | boolean;

export type DeclaredFact = {
  /** The value the operator verified. */
  readonly value: FactValue;
  /** When: ISO 8601 instant of verification. */
  readonly verifiedAt: string;
  /** How: "manual", "probe:aws-config" and similar, so the report can say. */
  readonly source: string;
};

export type FactsFile = {
  readonly facts: Readonly<Record<string, DeclaredFact>>;
};

export type FactStatus = {
  readonly name: string;
  readonly value: FactValue;
  readonly verifiedAt: string;
  readonly source: string;
  readonly ageHours: number;
  readonly stale: boolean;
};

export type FactsReport = {
  /** The plain map evaluate() consumes. */
  readonly values: Readonly<Record<string, FactValue>>;
  readonly statuses: readonly FactStatus[];
  /** The subset that went past the staleness window, for the CLI to show. */
  readonly stale: readonly FactStatus[];
};

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Hand written validation, the same posture as validatePrecondition: the
 * grammar is closed and a typo must surface as a load error with the path
 * in it, never as a quietly ignored fact.
 */
export function validateFactsFile(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null)
    return ["facts file: must be an object"];
  const top = value as Record<string, unknown>;
  const extraKeys = Object.keys(top).filter((key) => key !== "facts");
  if (extraKeys.length > 0)
    errors.push(`facts file: unknown key ${extraKeys.join(", ")}`);
  if (top.facts === undefined) return [...errors, "facts: required"];
  if (typeof top.facts !== "object" || top.facts === null)
    return [...errors, "facts: must be an object"];
  for (const [name, entry] of Object.entries(top.facts as Record<string, unknown>)) {
    const path = `facts.${name}`;
    if (name === "") errors.push(`${path}: a fact name is required`);
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${path}: must be an object`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const allowed = ["value", "verifiedAt", "source"];
    const extra = Object.keys(record).filter((key) => !allowed.includes(key));
    if (extra.length > 0) errors.push(`${path}: unknown key ${extra.join(", ")}`);
    if (typeof record.value !== "string" && typeof record.value !== "boolean")
      errors.push(`${path}.value: must be a string or a boolean`);
    if (typeof record.verifiedAt !== "string" || !ISO_INSTANT.test(record.verifiedAt))
      errors.push(`${path}.verifiedAt: must be an ISO 8601 instant`);
    else if (Number.isNaN(Date.parse(record.verifiedAt)))
      errors.push(`${path}.verifiedAt: must parse as a date`);
    if (typeof record.source !== "string" || record.source === "")
      errors.push(`${path}.source: required, how the fact was verified`);
  }
  return errors;
}

const HOUR_MS = 3_600_000;

export function loadFacts(
  file: FactsFile,
  now: Date,
  staleAfterHours = 168,
): FactsReport {
  const values: Record<string, FactValue> = {};
  const statuses: FactStatus[] = [];
  const stale: FactStatus[] = [];
  for (const [name, entry] of Object.entries(file.facts)) {
    const verifiedMs = Date.parse(entry.verifiedAt);
    // ageHours rounds down so a fact one second short of the window is not
    // yet stale; the boundary test pins this behaviour.
    const ageHours = Math.floor((now.getTime() - verifiedMs) / HOUR_MS);
    const isStale = ageHours > staleAfterHours;
    const status: FactStatus = {
      name,
      value: entry.value,
      verifiedAt: entry.verifiedAt,
      source: entry.source,
      ageHours,
      stale: isStale,
    };
    values[name] = entry.value;
    statuses.push(status);
    if (isStale) stale.push(status);
  }
  return { values, statuses, stale };
}

export function toEvaluationContext(
  report: FactsReport,
  args: Readonly<Record<string, unknown>>,
): EvaluationContext {
  // The evaluator treats absent and empty alike through the precondition
  // grammar, so a straight pass through is honest.
  return { facts: report.values, args };
}
