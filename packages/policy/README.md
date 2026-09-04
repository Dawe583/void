# @void/policy

Match rules, decisions, and the approval channel interface.

## Responsible for

Loading a declarative YAML rule file, validating it against a strict zod schema,
and answering allow, deny or hold for one classified call. First match wins by
file order. There is no expression language, no regular expression, no boolean
operator and no evaluator: the rules are total and inspectable, so a reviewer can
read the file top to bottom and know what happens to every call.

The whole grammar for version 1: a required `version: 1`, then an ordered list of
rules, each with a stable `id`, a `match` of at most five keys (`class`, `tool`,
`connector`, `workspace`, `blast_radius`), and a decision. Keys within a `match`
AND together, values within a key OR, which is what makes a sixth key additive
later instead of a breaking change.

## Defaults, which are not interchangeable

- No rule matched in a valid file: **hold**. The notification names the rule the
  operator is missing. The schema still requires an explicit terminal catch-all,
  so in a well formed file this never fires.
- File missing, unreadable, invalid or of an unknown version: **deny**, loudly.
- An unknown key or an unknown value anywhere: a **load error**, never ignored. A
  silently dropped condition widens a narrow rule to everything of its class.
- An unclassified call is treated as **r3**.

## Must never import

A connector, the proxy, or `@workspace/*`. The Slack and Teams channel
implementations live in a separate paid package: this package owns the channel
**interface** and the CLI channel, and both stay open source, because a policy
package that cannot notify anyone is not complete for its purpose.

## Cannot express, by design

Anything relating two calls: rate over time, a running total, time of day, an
irreversibility budget. Those need a counter store and are not a sixth match key.
Anything cross tool is the taint graph, WP-12.

## Public surface

- `POLICY_VERSION`, `MATCH_KEYS`, `MatchKey`, `isMatchKey`
- `Decision`, `UNMATCHED_DECISION`, `BROKEN_POLICY_DECISION`, `UNCLASSIFIED_CLASS`

The loader, the schema, the matcher and the blocking hold are WP-05 and do not
exist yet.
