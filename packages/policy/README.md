# @void/policy

Match rules, decisions, and the approval channel interface.

## Responsible for

Loading a declarative YAML rule file, validating it with `loadPolicy`,
and answering allow, deny or hold for one classified call. First match wins by
file order. There is no expression language, no regular expression, no boolean
operator and no evaluator: the rules are total and inspectable, so a reviewer can
read the file top to bottom and know what happens to every call.

The whole grammar for version 1: a required `version: 1`, then an ordered list of
rules, each with a `match` of at most five keys (`class`, `tool`, `connector`,
`workspace`, `blast_radius`), and a decision. The current loader rejects `id`;
decisions identify a matched hold or deny by its zero-based rule index. Keys within a `match`
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

- `loadPolicy`, `validatePolicyFile`, `LoadedPolicy`, `PolicyFile`
- `decide`, `PolicyCall`, `PolicyDecision`
- In `src/packs.ts`: `loadPack`, `listPacks`, `PackError`

## Policy packs

Each pack is a complete version 1 YAML policy in `packs/`. Every pack ends
with an explicit deny catch-all. Unknown classifications never receive an
allow from these packs. The proxy separately denies unknown tools and
unclassified calls in fail-closed posture.

| Pack | R0 | R1 | R2 | R3 | Use |
| ---- | -- | -- | -- | -- | --- |
| `dev` | allow | allow | allow | hold 60 seconds, CLI | Non-production developer loop |
| `balanced` | allow | allow | hold 300 seconds, CLI and Slack | deny | Human gate on mitigable calls |
| `strict` | allow | deny | deny | deny | Only fully reversible calls |

R0 means fully reversible. R1 means reversible with a trace. R2 means mitigable
only, with compensation rather than an inverse. R3 means irreversible. A class
belongs to a call evaluated against target facts, not to a tool in isolation.
Declared facts are only as reliable as the operator's configuration.

### Blast radius

Reversibility class is not blast radius. Blast radius is the measured count of
rows, files or objects touched. These starter packs do not cap that count:
`strict` can allow a large R0 call, `balanced` holds R2 at every size, and `dev`
allows R2 at every size even though it has no true inverse. None of the packs
turns an R2 or R3 call into a reversible call.

For a size limit, copy a pack and put a narrower rule before its class rule.
The current loader supports `match.blast_radius: { lt: 100 }`, not `lte`, `gt`,
`gte` or `eq`. A missing measured count does not satisfy that condition. If you
want larger or unmeasured calls denied, remove the broader allow rule for that
class so those calls reach the deny catch-all.

### Start the proxy with a pack

From the repository root, point `--policy` at a YAML file, not a pack name:

```sh
node packages/proxy/bin/void-proxy.mjs \
  --policy packages/policy/packs/balanced.yaml \
  --ledger-dir /tmp/void-dev-ledger \
  --workspace local \
  --upstream node --args /absolute/path/to/non-production-mcp-server.mjs
```

For a `void-proxy` binary on PATH, use the same flags and the absolute path to
your copied policy. The command above expects your own local MCP server.
Use declared facts through `--facts path` when its registry cases require them.

A hold is a request for a human decision, not delayed automatic approval.
An unresolved hold expires to deny. `notify` names channels; it does not install
or configure them. Configure the host's CLI approval broker and, for Slack
notifications in `balanced`, a Slack channel implementation. The pack does not
supply credentials or authenticate an approver.

### Load a pack in a host

```ts
import { loadPack, listPacks, PackError } from "./src/packs.ts";

const names = listPacks();
const loaded = await loadPack("balanced");
```

`loadPack(name, dir?)` returns the successful `LoadedPolicy` variant accepted by
`decide`. By default it reads next to the package, independent of the current
working directory. A directory override reads `<dir>/<name>.yaml`, for one of
the same three names. It never falls back to a bundled file if that override
is missing or invalid. Names cannot contain paths or a `.yaml` suffix.

`PackError` is thrown for an unknown name, unreadable file, YAML parse error,
validation failure or internal loader error. Hosts must deny or refuse startup
on this error, never substitute an allow policy. Override validation delegates
to `loadPolicy`; the pack loader does not implement a second grammar.

