/**
 * Policy: which calls are allowed, held or denied.
 *
 * The YAML loader, strict schema, matcher and blocking hold are exported below.
 * What is fixed here is the grammar
 * it validates against and the three defaults, because those are what make the
 * format growable without a breaking change (decision 4): keys AND together, so
 * a sixth key is additive, and an unknown key or value is a loud load error, so
 * a typo cannot quietly widen a narrow rule.
 */

export const POLICY_VERSION = 1;

/** The whole grammar. Five keys, and every one of them is used. */
export const MATCH_KEYS = ["class", "tool", "connector", "workspace", "blast_radius"] as const;

export type MatchKey = (typeof MATCH_KEYS)[number];

export type Decision = "allow" | "deny" | "hold";

/**
 * No rule in a valid file matched. Hold is the only decision that is itself
 * reversible, and the notification tells the operator which rule they are
 * missing, so the default teaches the policy file rather than blocking work or
 * silently permitting it. The schema still requires a terminal catch-all rule,
 * so in a well formed file this never fires.
 */
export const UNMATCHED_DECISION: Decision = "hold";

/**
 * The file is missing, unreadable, invalid, or of an unknown version. That is a
 * broken configuration rather than an unmatched call, and the two must not
 * resolve the same way.
 */
export const BROKEN_POLICY_DECISION: Decision = "deny";

/** An unclassified call is treated as R3, which makes registry coverage a safety property. */
export const UNCLASSIFIED_CLASS = "r3";

export function isMatchKey(name: string): name is MatchKey {
  return (MATCH_KEYS as readonly string[]).includes(name);
}

export * from "./rules.ts";
export * from "./packs.ts";
export * from "./decide.ts";
export * from "./hold.ts";
export * from "./channels/cli.ts";
export * from "./approvals.ts";
export * from "./channels/slack.ts";
