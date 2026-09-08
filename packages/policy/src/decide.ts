/**
 * The decider, WP-05. A classified call and a loaded policy in, one of
 * three decisions out, first rule wins.
 *
 * The inputs are already separated by ownership: the class and the blast
 * radius come from the registry side, the rule file from the operator, and
 * this module matches one against the other without knowing how either was
 * produced. That is the seam that lets the proxy stay dumb about policy and
 * the policy stay dumb about transports.
 */

import { UNMATCHED_DECISION, type MatchKey } from "./index.ts";
import type { LoadedPolicy, Rule, RuleMatch } from "./rules.ts";

/** The call, as the registry and the proxy see it. */
export type PolicyCall = {
  /** The registry entry id, for example aws.s3.object.delete. */
  readonly tool: string;
  /** The connector of the intercepted server, for example s3 or postgres. */
  readonly connector: string;
  /** The workspace tag the proxy was started with, if any. */
  readonly workspace: string | undefined;
  /** The reversibility class the evaluator decided, or the assumed worst. */
  readonly klass: string;
  /** Rows, files or objects the intercepted call would touch. */
  readonly blastRadius: number | undefined;
};

/** The resolved action for a call. */
export type PolicyDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly ruleIndex: number; readonly rationale: string | undefined }
  | {
      readonly kind: "hold";
      readonly ruleIndex: number;
      readonly seconds: number;
      readonly notify: readonly string[];
      readonly rationale: string | undefined;
    }
  | {
      /** No rule matched: possible only in a file that passed validation but was replaced between load and call. */
      readonly kind: "unmatched";
      readonly decision: typeof UNMATCHED_DECISION;
    };

function matchesOne(rule: Rule, call: PolicyCall): boolean {
  const entries = Object.entries(rule.match as RuleMatch);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey as MatchKey;
    // An undefined call side never matches: an unknown value is a
    // non-match, not a match-everything, which keeps an unspecified
    // workspace from widening a rule the operator wrote narrowly.
    switch (key) {
      case "class":
        if (!valueMatches(rawValue, call.klass)) return false;
        break;
      case "tool":
        if (!valueMatches(rawValue, call.tool)) return false;
        break;
      case "connector":
        if (!valueMatches(rawValue, call.connector)) return false;
        break;
      case "workspace":
        if (call.workspace === undefined) return false;
        if (!valueMatches(rawValue, call.workspace)) return false;
        break;
      case "blast_radius": {
        const condition = rawValue as { lt: number };
        if (call.blastRadius === undefined) return false;
        if (!(call.blastRadius < condition.lt)) return false;
        break;
      }
    }
  }
  return true;
}

function valueMatches(expected: unknown, actual: string): boolean {
  if (Array.isArray(expected)) return expected.includes(actual);
  if (typeof expected === "number") return String(expected) === actual;
  return expected === actual;
}

/**
 * First match wins. The rules came validated from the loader, so the
 * catch-all is the last one; an unmatched call here means the file was
 * replaced mid-flight, and the unmatched decision is the fail-closed
 * answer that tells the operator their file changed under them.
 */
export function decide(
  policy: LoadedPolicy,
  call: PolicyCall,
): PolicyDecision {
  if (!policy.ok) throw new TypeError("decide requires a validated policy; a broken file is the caller's deny path");
  for (let index = 0; index < policy.policy.rules.length; index += 1) {
    const rule = policy.policy.rules[index]!;
    if (!matchesOne(rule, call)) continue;
    if (rule.decision === "allow") return { kind: "allow" };
    if (rule.decision === "deny")
      return { kind: "deny", ruleIndex: index, rationale: rule.rationale };
    return {
      kind: "hold",
      ruleIndex: index,
      seconds: rule.seconds!,
      notify: rule.notify ?? ["cli"],
      rationale: rule.rationale,
    };
  }
  return { kind: "unmatched", decision: UNMATCHED_DECISION };
}
