/**
 * The rule file, WP-05. YAML in, validated rules out, first match wins.
 *
 * The grammar is deliberately a matching language and nothing more: five
 * keys, three decisions, and every unknown key or value is a loud load
 * error, because a typo that silently drops a condition widens a narrow
 * rule to everything of that class, and in a tool that gates writes that
 * means allowing what should have been held. The plan rejects a policy DSL;
 * this file is the line drawn on that side of it.
 */

import { parse } from "yaml";
import { isMatchKey, type MatchKey, type Decision, POLICY_VERSION } from "./index.ts";

/** The value a match key compares against; a list means any of. */
export type MatchValue = string | number | readonly string[];

export type BlastRadiusCondition = {
  /** Fewer than: the only comparison the hold message needs. */
  readonly lt: number;
};

export type RuleMatch = {
  readonly [key: string]: MatchValue | BlastRadiusCondition | undefined;
};

export type NotifyChannel = "cli" | "slack";

export type Rule = {
  /** The match block; keys AND together, list values mean any of. */
  readonly match: RuleMatch;
  readonly decision: Decision;
  /** Present only when the decision is hold. */
  readonly seconds?: number;
  /** Where the hold is announced; the CLI channel always works. */
  readonly notify?: readonly NotifyChannel[];
  /** Why the rule exists, shown in the hold message the model reads. */
  readonly rationale?: string;
};

export type PolicyFile = {
  readonly version: number;
  readonly rules: readonly Rule[];
};

export type LoadedPolicy =
  | { readonly ok: true; readonly policy: PolicyFile }
  | { readonly ok: false; readonly errors: readonly string[] };

const DECISIONS: readonly Decision[] = ["allow", "deny", "hold"];
const CHANNELS: readonly NotifyChannel[] = ["cli", "slack"];

/**
 * Hand written validation, the same posture as the registry: the grammar
 * is small and a validator that names the path in the file catches more
 * than a generic schema and stays reviewable.
 */
export function validatePolicyFile(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null)
    return ["policy file: must be an object"];
  const top = value as Record<string, unknown>;
  const topKeys = Object.keys(top).filter((k) => !["version", "rules"].includes(k));
  if (topKeys.length > 0) errors.push(`policy file: unknown key ${topKeys.join(", ")}`);
  if (top.version !== POLICY_VERSION)
    errors.push(`version: must be ${POLICY_VERSION}, got ${JSON.stringify(top.version)}`);
  if (!Array.isArray(top.rules)) return [...errors, "rules: required, a list of rules"];
  if (top.rules.length === 0) errors.push("rules: at least one rule is required");
  top.rules.forEach((raw, index) => {
    const path = `rules[${index}]`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${path}: must be an object`);
      return;
    }
    const rule = raw as Record<string, unknown>;
    const ruleKeys = Object.keys(rule).filter(
      (k) => !["match", "decision", "seconds", "notify", "rationale"].includes(k),
    );
    if (ruleKeys.length > 0) errors.push(`${path}: unknown key ${ruleKeys.join(", ")}`);
    if (rule.match === undefined || typeof rule.match !== "object" || rule.match === null) {
      errors.push(`${path}.match: required, an object of match keys`);
    } else {
      const match = rule.match as Record<string, unknown>;
      // An empty match matches everything; only the terminal rule may carry
      // it, and that is checked as a file property after the loop.
      for (const [key, val] of Object.entries(match)) {
        if (!isMatchKey(key)) {
          errors.push(`${path}.match.${key}: not a match key, expected one of class, tool, connector, workspace, blast_radius`);
          continue;
        }
        if (key === "blast_radius") {
          if (typeof val !== "object" || val === null || typeof (val as Record<string, unknown>).lt !== "number")
            errors.push(`${path}.match.blast_radius: must be { lt: number }`);
          else {
            const extra = Object.keys(val as Record<string, unknown>).filter((k) => k !== "lt");
            if (extra.length > 0) errors.push(`${path}.match.blast_radius: unknown key ${extra.join(", ")}`);
          }
          continue;
        }
        if (typeof val === "string" || typeof val === "number") continue;
        if (Array.isArray(val)) {
          if (val.length === 0) errors.push(`${path}.match.${key}: an empty list matches nothing`);
          else if (!val.every((item) => typeof item === "string"))
            errors.push(`${path}.match.${key}: a list value must be strings`);
          continue;
        }
        errors.push(`${path}.match.${key}: must be a string, a number or a list of strings`);
      }
    }
    if (!DECISIONS.includes(rule.decision as Decision))
      errors.push(`${path}.decision: must be allow, deny or hold`);
    if (rule.decision === "hold") {
      const seconds = rule.seconds;
      if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1)
        errors.push(`${path}.seconds: required for hold, a whole number of seconds, at least 1`);
      else if (seconds > 900)
        errors.push(`${path}.seconds: the hold ceiling is 900 seconds, so the MCP request cannot outlive every client timeout`);
    } else if (rule.seconds !== undefined) {
      errors.push(`${path}.seconds: only a hold has a timer`);
    }
    if (rule.notify !== undefined) {
      if (!Array.isArray(rule.notify) || rule.notify.length === 0)
        errors.push(`${path}.notify: a non-empty list of channels when present`);
      else if (!rule.notify.every((c) => CHANNELS.includes(c as NotifyChannel)))
        errors.push(`${path}.notify: must be cli or slack`);
    }
    if (rule.rationale !== undefined && typeof rule.rationale !== "string")
      errors.push(`${path}.rationale: must be a string`);
  });
  // The terminal catch-all: a file without one leaves calls unmatched, and
  // an unmatched call and a broken file must not resolve the same way.
  const rules = top.rules as Record<string, unknown>[];
  const terminal = rules.find((rule) => {
    const match = rule.match;
    return typeof match === "object" && match !== null && Object.keys(match).length === 0;
  });
  if (!terminal)
    errors.push("rules: the last rule must be the unguarded catch-all, match: {}");
  const terminalIndex = rules.indexOf(terminal ?? rules[rules.length - 1] as Record<string, unknown>);
  if (terminal && terminalIndex !== rules.length - 1)
    errors.push("rules: the catch-all must be the last rule, because first match wins");
  return errors;
}

/**
 * Parses YAML text and validates it. A load error is returned, never
 * thrown, because the caller is the proxy: it must deny on a broken file
 * with a reason, not crash, and BROKEN_POLICY_DECISION exists for exactly
 * that path.
 */
export function loadPolicy(text: string): LoadedPolicy {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return { ok: false, errors: [`yaml: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const errors = validatePolicyFile(parsed);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, policy: parsed as PolicyFile };
}
