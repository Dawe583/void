# VOID policy file reference

This is the field-by-field reference for version 1 policy files.
It is generated from the types and the validator in
`packages/policy/src/rules.ts`, with matching, hold, and approval
behavior from `decide.ts`, `hold.ts`, `approvals.ts`, and `index.ts`.

Where it goes deeper than `docs/OPERATIONS.md`: the "Policy grammar
quick table" in OPERATIONS.md is a one-screen summary of field names
and shapes. This reference goes deeper by documenting every Rule
field with its type line, every accepted match value shape, the exact
`BlastRadiusCondition` shape, the exact `NotifyChannel` values, every
rejection string `validatePolicyFile` can return, the two different
defaults for "no rule matched" versus "file is broken", and how a
hold resolves through the approval broker. Where this reference and
the OPERATIONS.md quick table disagree on `blast_radius` operators,
this reference follows the validator; see the note at the end of the
`blast_radius` section.

## File shape

A policy file is YAML text parsed into an object with exactly two
top-level keys (packages/policy/src/rules.ts:63):

- `version`: required. Must equal `POLICY_VERSION`, which is `1`
  (packages/policy/src/index.ts:12, packages/policy/src/rules.ts:65-66).
- `rules`: required. Must be a non-empty list of rule objects
  (packages/policy/src/rules.ts:67-68).

The TypeScript shape is `PolicyFile`
(packages/policy/src/rules.ts:41-44):

```ts
export type PolicyFile = {
  readonly version: number;
  readonly rules: readonly Rule[];
};
```

`loadPolicy` parses the YAML and validates it, and returns errors
instead of throwing, so the proxy can deny with a reason rather than
crash (packages/policy/src/rules.ts:151-161). A YAML syntax failure
returns an error of the form `yaml: <parser message>`
(packages/policy/src/rules.ts:156).

## Rule fields

The TypeScript shape is `Rule` (packages/policy/src/rules.ts:29-39).
A rule accepts exactly these five keys; any other key on a rule is a
load error (packages/policy/src/rules.ts:76-79):

| Field | Required | Type line | Meaning |
| ----- | -------- | --------- | ------- |
| `match` | yes | packages/policy/src/rules.ts:31 | Object of match keys. Keys AND together; list values mean any of. An empty object `match: {}` matches every call and is the terminal catch-all. |
| `decision` | yes | packages/policy/src/rules.ts:32 | One of `allow`, `deny`, `hold` (packages/policy/src/rules.ts:50, packages/policy/src/rules.ts:110-111). |
| `seconds` | for hold only | packages/policy/src/rules.ts:34 | Whole number of seconds, at least 1, at most 900 (packages/policy/src/rules.ts:114-117). Present only when `decision` is `hold`; on any other decision it is a load error (packages/policy/src/rules.ts:118-119). |
| `notify` | no | packages/policy/src/rules.ts:36 | Non-empty list holding `cli` and/or `slack` (packages/policy/src/rules.ts:27, packages/policy/src/rules.ts:121-125). The CLI channel always works (packages/policy/src/rules.ts:35). When absent on a hold, the decider defaults it to `["cli"]` (packages/policy/src/decide.ts:105). |
| `rationale` | no | packages/policy/src/rules.ts:38 | String explaining why the rule exists; shown in the hold message the model reads (packages/policy/src/rules.ts:37). Must be a string when present (packages/policy/src/rules.ts:127-128). |

## Match keys

There are exactly five match keys
(packages/policy/src/index.ts:15):

```ts
export const MATCH_KEYS = ["class", "tool", "connector", "workspace", "blast_radius"] as const;
```

Any other key inside `match` is a load error
(packages/policy/src/rules.ts:87-89):

```text
rules[0].match.severity: not a match key, expected one of class, tool, connector, workspace, blast_radius
```

The value type for scalar keys is `MatchValue`
(packages/policy/src/rules.ts:16):

```ts
export type MatchValue = string | number | readonly string[];
```

Per-key value shapes (packages/policy/src/rules.ts:100-107):

- `class`: one of `r0`, `r1`, `r2`, `r3`, or a non-empty list of
  those values. Example: `class: [r2, r3]`. Unknown classes are load errors.
- `tool`: a string such as `postgres.row.delete`, a number, or a
  list of strings. Example from the real fixture: `tool: echo`
  (fixtures/e2e-policy.yaml:4).
- `connector`: a string such as `postgres` or `s3`, a number, or a
  list of strings.
- `workspace`: a string, a number, or a list of strings. A rule that
  names `workspace` never matches a call that has no workspace; an
  undefined call side is a non-match, not a match-everything
  (packages/policy/src/decide.ts:63-65).
- `blast_radius`: only `{ lt: <number> }`. See below.

Semantics shared by all keys:

- Keys within one `match` AND together: every key must match for the
  rule to match (packages/policy/src/rules.ts:30,
  packages/policy/src/decide.ts:46-76).
- A list value means any of: the call matches if its value is
  included in the list (packages/policy/src/decide.ts:78-82).
- A number value matches when its string form equals the call value
  (packages/policy/src/decide.ts:80).
- An undefined call side never matches. An unknown `blastRadius` does
  not satisfy a `blast_radius` condition, and an unknown `workspace`
  does not satisfy a `workspace` condition
  (packages/policy/src/decide.ts:50-52,
  packages/policy/src/decide.ts:63-70).

## BlastRadiusCondition

The TypeScript shape is (packages/policy/src/rules.ts:18-21):

```ts
export type BlastRadiusCondition = {
  /** Fewer than: the only comparison the hold message needs. */
  readonly lt: number;
};
```

Rules enforced by the validator (packages/policy/src/rules.ts:91-98):

- The value must be an object whose `lt` is a nonnegative safe integer; anything else
  is rejected with `rules[N].match.blast_radius: must be { lt: number }`.
- Extra keys beside `lt` are rejected with
  `rules[N].match.blast_radius: unknown key <names>`.

At match time the call matches only when its measured blast radius
(rows, files, or objects the call would touch,
packages/policy/src/decide.ts:25-26) is defined and strictly less
than `lt` (packages/policy/src/decide.ts:67-71).

Note on OPERATIONS.md: the "Policy grammar quick table" lists
`{ lt: n }`, `{ lte: n }`, `{ gt: n }`, `{ gte: n }`, and `{ eq: n }`
for `match.blast_radius`. The validator accepts only `{ lt: number }`;
a file using `lte` is rejected with
`rules[0].match.blast_radius: must be { lt: number }` (reproduced
against the validator; see "Common mistakes"). Until the validator
changes, write only `{ lt: n }`.

## NotifyChannel values

The type is (packages/policy/src/rules.ts:27):

```ts
export type NotifyChannel = "cli" | "slack";
```

Validator rules (packages/policy/src/rules.ts:121-125):

- When present, `notify` must be a non-empty list, else
  `rules[N].notify: a non-empty list of channels when present`.
- Every entry must be `cli` or `slack`, else
  `rules[N].notify: must be cli or slack`.

The decider fills a missing `notify` on a hold with `["cli"]`
(packages/policy/src/decide.ts:105), and the broker rejects any other
channel name at registration with `unknown approval channel <value>`
(packages/policy/src/approvals.ts:241-248).

## Decisions and first match wins

`Decision` is `"allow" | "deny" | "hold"`
(packages/policy/src/index.ts:19). `decide` walks the rules in file
order and the first matching rule wins
(packages/policy/src/decide.ts:90-108):

- `allow` returns `{ kind: "allow" }`
  (packages/policy/src/decide.ts:98).
- `deny` returns `{ kind: "deny", ruleIndex, rationale }`
  (packages/policy/src/decide.ts:99-100).
- `hold` returns `{ kind: "hold", ruleIndex, seconds, notify, rationale }`
  (packages/policy/src/decide.ts:101-107).

`decide` requires an already validated policy and throws a `TypeError`
on a broken file, because a broken file is the caller's deny path,
not a decision (packages/policy/src/decide.ts:94).

The file must end with the unguarded catch-all `match: {}`, and that
catch-all must be the last rule, because first match wins
(packages/policy/src/rules.ts:137-141):

```text
rules: the last rule must be the unguarded catch-all, match: {}
rules: the catch-all must be the last rule, because first match wins
```

## Every validatePolicyFile rejection

Each string below is quoted verbatim from the validator
(packages/policy/src/rules.ts:58-143). `N` is the zero-based rule
index.

```text
policy file: must be an object
policy file: unknown key <names>
version: must be 1, got <json>
rules: required, a list of rules
rules: at least one rule is required
rules[N]: must be an object
rules[N]: unknown key <names>
rules[N].match: required, an object of match keys
rules[N].match.<key>: not a match key, expected one of class, tool, connector, workspace, blast_radius
rules[N].match.blast_radius: must be { lt: number }
rules[N].match.blast_radius: unknown key <names>
rules[N].match.<key>: an empty list matches nothing
rules[N].match.<key>: a list value must be strings
rules[N].match.<key>: must be a string, a number or a list of strings
rules[N].decision: must be allow, deny or hold
rules[N].seconds: required for hold, a whole number of seconds, at least 1
rules[N].seconds: the hold ceiling is 900 seconds, so the MCP request cannot outlive every client timeout
rules[N].seconds: only a hold has a timer
rules[N].notify: a non-empty list of channels when present
rules[N].notify: must be cli or slack
rules[N].rationale: must be a string
rules: the last rule must be the unguarded catch-all, match: {}
rules: the catch-all must be the last rule, because first match wins
```

Plus the YAML layer from `loadPolicy`: `yaml: <parser message>`
(packages/policy/src/rules.ts:156).

## Default posture when nothing matches: fail-closed

Two different defaults apply, and they must not resolve the same way
(packages/policy/src/rules.ts:130-131,
packages/policy/src/index.ts:30-35):

- No rule matched in a valid file: `UNMATCHED_DECISION`, which is
  `"hold"` (packages/policy/src/index.ts:28). Hold is the only
  decision that is itself reversible, and its notification tells the
  operator which rule they are missing
  (packages/policy/src/index.ts:21-27). In a well formed file this
  never fires because the terminal catch-all matches everything
  (packages/policy/src/index.ts:25-26,
  packages/policy/src/decide.ts:84-89).
- File missing, unreadable, invalid, or of an unknown version:
  `BROKEN_POLICY_DECISION`, which is `"deny"`
  (packages/policy/src/index.ts:35). That is a broken configuration,
  not an unmatched call (packages/policy/src/index.ts:30-34).

The proxy enforces the broken-file side at startup: it loads the
policy with `loadPolicy` and throws a `PolicyStartupError` naming the
validator errors, so a bad file denies startup instead of starting
unguarded (packages/proxy/src/bin.ts:327-332). The default proxy
posture is `fail-closed`
(packages/proxy/src/index.ts:13-15), and fail-closed startup requires
a ledger directory (packages/proxy/src/bin.ts:89-93).

Related default: an unclassified call is treated as `r3`
(`UNCLASSIFIED_CLASS`, packages/policy/src/index.ts:38), which makes
registry coverage a safety property
(packages/policy/src/index.ts:37).

## How holds resolve via approvals.ts

A hold parks the MCP response until a human resolves it or the timer
fires (packages/policy/src/hold.ts:1-11):

1. The `HoldQueue` parks the call and returns the promise the MCP
   response waits on. The timer is unref'd so an idle queue cannot
   keep the proxy alive (packages/policy/src/hold.ts:112-139). Hold
   ids look like `h0001` (packages/policy/src/hold.ts:118).
2. The `ApprovalBroker` registers the parked hold, assigns a
   per-hold nonce (`decisionToken`), and fans the notification out to
   the rule's channels (packages/policy/src/approvals.ts:101-121).
   The broker owns no timers by design; the proxy pumps `expire()`
   (packages/policy/src/approvals.ts:1-6,
   packages/policy/src/approvals.ts:146-161).
3. A human approves or denies through `broker.decide(holdId,
   decision)`, where a decision is `{ kind: "approved" | "denied",
   by, reason? }` with a non-empty `by`
   (packages/policy/src/approvals.ts:123-144,
   packages/policy/src/approvals.ts:318-325). Deciding an unknown,
   finished, or non-pending id returns `false`, never a crash
   (packages/policy/src/approvals.ts:128,
   packages/policy/src/hold.ts:141-147).
4. Expiry resolves the hold as expired
   (packages/policy/src/approvals.ts:146-161). The agent-facing error
   body names the tool, class, blast radius, rule index, and result,
   and a denied release adds "Do not retry the same call; it was
   rejected by <by>." so the agent does not learn to evade the gate
   by rephrasing (packages/policy/src/hold.ts:55-85). Expiry uses
   code `-32000`; a released hold uses `-32003`
   (packages/policy/src/hold.ts:74).
5. The file-backed path works through the approvals state directory:
   `pending.json` plus `decisions/<nonce>.json`, owned by one proxy
   via an exclusive `proxy.lock`; a second live proxy gets
   `ApprovalStateInUseError` instead of sharing state
   (packages/policy/src/approvals.ts:77-99,
   packages/policy/src/approvals.ts:348-354). Decision files bind to
   the per-hold nonce so a stale file cannot replay onto a later hold
   with the same id (packages/policy/src/approvals.ts:190-211,
   packages/policy/src/approvals.ts:282-292). The CLI surfaces this
   with `approvals --dir` and `approve <holdId> --by`
   (docs/OPERATIONS.md:174-181). Payload arguments are never stored beyond the
   process and are not part of `ApprovalRecord`
   (packages/policy/src/hold.ts:29,
   packages/policy/src/approvals.ts:254-261).

## End-to-end example (actually run)

The fixture `fixtures/e2e-policy.yaml` is a real three-rule policy:

```yaml
version: 1
rules:
  - match:
      tool: echo
    decision: allow
  - match:
      tool: orders_delete
    decision: hold
    seconds: 5
    notify: [cli]
    rationale: destructive fixture tool requires approval
  - match: {}
    decision: deny
    rationale: only e2e fixture tools are allowed
```

Exact command run from the repository root:

```sh
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { loadPolicy } from './packages/policy/src/rules.ts'; import { decide } from './packages/policy/src/decide.ts'; const loaded = loadPolicy(readFileSync('fixtures/e2e-policy.yaml', 'utf8')); console.log('loaded ok:', loaded.ok); if (!loaded.ok) { console.log(loaded.errors); process.exit(1); } for (const call of [{ tool: 'echo', connector: 'stdio', workspace: 'demo', klass: 'r0', blastRadius: 1 }, { tool: 'orders_delete', connector: 'stdio', workspace: 'demo', klass: 'r3', blastRadius: 4 }, { tool: 'something_else', connector: 'stdio', workspace: 'demo', klass: 'r2', blastRadius: 10 }]) console.log(call.tool, '=>', JSON.stringify(decide(loaded, call)));"
```

Real output (exit code 0):

```text
loaded ok: true
echo => {"kind":"allow"}
orders_delete => {"kind":"hold","ruleIndex":1,"seconds":5,"notify":["cli"],"rationale":"destructive fixture tool requires approval"}
something_else => {"kind":"deny","ruleIndex":2,"rationale":"only e2e fixture tools are allowed"}
```

The `echo` call matches rule 0 and is allowed; `orders_delete`
matches rule 1 and holds for 5 seconds with CLI notification; the
unnamed tool falls to the catch-all rule 2 and is denied.

## Common mistakes

Each entry below was reproduced against `loadPolicy`; the error
string is quoted verbatim.

1. Using `lte` (or `gt`, `gte`, `eq`) in `blast_radius`. Only `lt`
   is accepted (packages/policy/src/rules.ts:91-93):
   `rules[0].match.blast_radius: must be { lt: number }`
2. A `hold` without `seconds`
   (packages/policy/src/rules.ts:112-115):
   `rules[0].seconds: required for hold, a whole number of seconds, at least 1`
3. Putting `seconds` on an `allow` or `deny` rule
   (packages/policy/src/rules.ts:118-119):
   `rules[0].seconds: only a hold has a timer`
4. A hold longer than the 900-second ceiling
   (packages/policy/src/rules.ts:116-117):
   `rules[0].seconds: the hold ceiling is 900 seconds, so the MCP request cannot outlive every client timeout`
5. Forgetting the terminal catch-all
   (packages/policy/src/rules.ts:137-138):
   `rules: the last rule must be the unguarded catch-all, match: {}`
6. Putting the catch-all anywhere but last
   (packages/policy/src/rules.ts:140-141):
   `rules: the catch-all must be the last rule, because first match wins`
7. A `notify` channel that is not `cli` or `slack`
   (packages/policy/src/rules.ts:124-125):
   `rules[0].notify: must be cli or slack`
8. A match key that is not one of the five
   (packages/policy/src/rules.ts:87-88):
   `rules[0].match.severity: not a match key, expected one of class, tool, connector, workspace, blast_radius`
9. A decision that is not `allow`, `deny`, or `hold`
   (packages/policy/src/rules.ts:110-111):
   `rules[0].decision: must be allow, deny or hold`
10. An empty list value, which matches nothing
    (packages/policy/src/rules.ts:102):
    `rules[0].match.class: an empty list matches nothing`


## Local hardening update, 11 September 2026

A missing, failed, or invalid probe leaves blast radius unknown. Agent arguments
such as `rows`, `count`, `limit`, and `n` never supply a policy measurement.
Rules requiring a radius therefore do not match without a valid measurement;
the next rule, normally the final deny or hold, decides. The development binary
currently has no probe provider wired, so radius-dependent allow rules do not
match there. Library hosts can supply a probe to `interceptCall`.

A rule and its match must be objects, not arrays. Null rules, unknown classes,
and invalid radius thresholds return load errors. YAML parse errors report a
generic syntax failure without echoing potentially private policy source.
