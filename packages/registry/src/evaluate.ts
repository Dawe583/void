/**
 * The case evaluator, WP-04a. Tool id plus arguments plus a context of
 * declared facts in, the first matching case out.
 *
 * The registry stopped being a lookup table here. An unclassified call must
 * never fall through to a guess: policy treats it as R3 (that constant lives
 * in @void/policy), so this module's job is to say precisely which case
 * matched and which precondition failed when one did not, because a hold
 * message that cannot name the missing fact teaches the operator nothing.
 */

import { findEntry, type RegistryEntry, type RegistryTone } from "./registry.ts";
import { holds, type Precondition } from "./precondition.ts";

export type EvaluationContext = {
  /** Declared facts about the target, from the operator's configuration. */
  readonly facts: Readonly<Record<string, string | boolean | undefined>>;
  /** The intercepted call's arguments. */
  readonly args: Readonly<Record<string, unknown>>;
};

export type EvaluationResult =
  | {
      readonly outcome: "classified";
      readonly entryId: string;
      readonly caseIndex: number;
      readonly tone: RegistryTone;
      /** The prose of the matched case, for the hold message and the ledger. */
      readonly reason: string;
    }
  | {
      readonly outcome: "unknown-tool";
      readonly entryId: string;
    }
  | {
      readonly outcome: "unclassified";
      readonly entryId: string;
      /**
       * The worst tone among the cases that failed only because their facts
       * were absent, so the caller can show the class it must assume while
       * naming the facts that would have decided it. Null when no case
       * failed that way, because a present-but-wrong fact is a real non
       * match and must never be dressed up as a configuration gap.
       */
      readonly assumeTone: RegistryTone | null;
      readonly missingFacts: readonly string[];
    };

type EvaluableCase = RegistryEntry["cases"][number] & {
  readonly if?: Precondition;
};

/** Tone rank, r0 best to r3 worst, mirroring the rank the stats queries use. */
const TONE_RANK: Record<RegistryTone, number> = { r0: 0, r1: 1, r2: 2, r3: 3 };

export function evaluate(
  entry: RegistryEntry,
  context: EvaluationContext,
): EvaluationResult {
  const cases = entry.cases as readonly EvaluableCase[];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]!;
    if (item.if === undefined) continue;
    if (holds(item.if, context.facts, context.args)) {
      return {
        outcome: "classified",
        entryId: entry.id,
        caseIndex: index,
        tone: item.tone,
        reason: item.when,
      };
    }
  }

  // No structured case matched. Per case, not in aggregate: a case that
  // failed because a fact is absent is a configuration gap the operator can
  // close, and its worst tone is the one to assume. A case that failed on a
  // present-but-wrong fact is a real non match and contributes nothing.
  const missing = new Set<string>();
  let anyStructured = false;
  let assume: RegistryTone | null = null;
  for (const item of cases) {
    if (item.if === undefined) continue;
    anyStructured = true;
    const facts = new Set<string>();
    collectFactNames(item.if, facts);
    let allAbsent = facts.size > 0;
    for (const fact of facts) {
      if (context.facts[fact] === undefined) missing.add(fact);
      else allAbsent = false;
    }
    // The tone to assume is the worst among the guarded cases that failed
    // only because facts were absent. A case whose facts were present but
    // wrong is a decided non match, not an open question.
    if (allAbsent && (assume === null || TONE_RANK[item.tone] > TONE_RANK[assume]))
      assume = item.tone;
  }
  if (!anyStructured) return { outcome: "unclassified", entryId: entry.id, assumeTone: null, missingFacts: [] };
  return {
    outcome: "unclassified",
    entryId: entry.id,
    assumeTone: assume,
    missingFacts: [...missing],
  };
}

/**
 * The whole-pipeline convenience. Policy calls this, not evaluate, because
 * policy sees tool ids and must learn about the ones no entry covers; a
 * call to a tool that no entry knows is unknown-tool and the fail closed
 * posture applies to it exactly as to an unclassifiable entry.
 */
export function classifyTool(
  toolId: string,
  context: EvaluationContext,
): EvaluationResult {
  const entry = findEntry(toolId);
  if (entry === undefined)
    return { outcome: "unknown-tool", entryId: toolId };
  return evaluate(entry, context);
}

function collectFactNames(
  precondition: Precondition,
  into: Set<string>,
): void {
  switch (precondition.kind) {
    case "fact":
      into.add(precondition.fact);
      break;
    case "not":
      collectFactNames(precondition.of, into);
      break;
    case "argument":
      break;
    case "all":
    case "any":
      for (const item of precondition.of) collectFactNames(item, into);
      break;
  }
}
