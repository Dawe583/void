# macOS: guided projects with verifiable recovery

Research and implementation record, 12 September 2026. iOS is deferred.
This document distinguishes shipped work, source findings and proposed work.
It does not claim that VOID already fulfills every feature on the marketing site.

## Direction

VOID should let a new user choose a project, connect an account, preview the
agent's proposed changes and recover the supported effects. Its distinguishing
feature should be a verifiable recovery history across tools. A large list of
preinstalled tools alone is not a defensible differentiator.

The initial macOS experience should take three deliberate steps:

1. Choose a project type and its working folder.
2. Connect the accounts that project actually needs, with a readiness check.
3. Start with a concrete task and visible recovery coverage.

OAuth consent, service charges and filesystem access cannot honestly be hidden
behind a claim that every service is already connected for every user.

## Findings from primary sources

| Source | Observed capability | Consequence for VOID |
| --- | --- | --- |
| [MCP Bundles README](https://github.com/modelcontextprotocol/mcpb/blob/main/README.md) | A portable archive contains a server and manifest; desktop clients can offer single-click installation | Prefer compatibility with MCPB over inventing a proprietary package format |
| [MCPB manifest](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md) | User configuration supports sensitive fields, directory/file selection and compatibility requirements | Generate setup forms from validated metadata; store secrets separately in Keychain |
| [Official MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/README.md) | Discovery service for MCP server metadata | Discovery is not proof of tool safety, authenticity of every effect, or recovery support |
| [OpenCode MCP documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/mcp-servers.mdx) | Local/remote MCP, OAuth and explicit warnings about tool context growth | Install only selected packages; expose task-relevant schemas rather than every installed tool on every turn |
| [GitHub MCP server](https://github.com/github/github-mcp-server/blob/main/README.md) | Remote and local modes, OAuth/PAT authentication and selectable toolsets | Prefer official integrations; begin with narrow toolsets and prove account/repository scope |

These upstream documents were retrieved during this task. They are mutable
references, not compatibility certification. The OpenCode website returned 403;
the official repository documentation was used instead. No paid research service
or new connector was provisioned for this review.

## What shipped in this iteration

- Desktop Settings discovers supported API credentials in fixed OpenCode and
  Prime configuration files. Discovery contacts no model provider.
- An explicit Import action validates a credential against a fixed provider
  endpoint, saves it in VOID's encrypted local workspace and selects an available
  default model. It does not send the key to the web app or modify source files.
- Supported imports: TokenRouter from Prime models configuration; OpenCode Zen
  and OpenRouter from OpenCode/Prime API-key stores. OAuth sessions, shell/env/file
  expressions, arbitrary provider URLs and unknown sources are not imported.
- The API is enabled only in the local desktop runtime. Remote-token servers
  and ordinary local web servers cannot use this credential-import endpoint.
- Fixed a provider-switch bug: the previous provider's unavailable default model
  could remain selected. Empty model catalogs are now rejected before activation.
- Setup distinguishes local managed-document Undo from unsupported automatic
  recovery of arbitrary disk files and external tools.

Real-provider smoke checks validated TokenRouter (137 models, GLM 5.3 Free
selected) and OpenCode Zen (70 models, an available default selected). They used
a temporary encrypted workspace, contacted only model-catalog endpoints and
removed the test workspace. They did not execute paid chat calls or mutate cloud
provider settings.

Seven focused tests cover fixed credential destinations, no key disclosure,
encrypted restart, GLM selection, OAuth/expression rejection, malformed/oversized
files, symlinks, provider/network failure, empty catalogs, competing writers,
local-only HTTP access, foreign origins and extra import parameters. The normal
repository checks remain the broader regression gate.

## Proposed project packs

These are priorities for implementation, not installed or certified packs.

| Pack | Intended tools | Default scope | Recovery requirement |
| --- | --- | --- | --- |
| Write and research | Managed documents, selected web retrieval, document export | App-owned project documents; web reads | Exact managed-document recovery, source citations, no claim to retract disclosed data |
| Build a website | Managed files/Git, browser testing, GitHub, optional Vercel | Chosen worktree, one repository, preview deployment | Local file/Git restore first; deployment rollback labelled configuration recovery with external effects |
| Data project | CSV/SQLite initially, optional PostgreSQL | Selected files or explicitly configured tables | Proven snapshot/restore; supported SQL contract; reject unsupported DDL/cascades |
| Existing coding project | Git inspection, selected runtime, browser testing, narrow coding tools | Explicit project folder and branch | Capture before writes; conflict and unknown-state detection; unobserved shell effects remain unsupported |

Do not ship messaging, purchasing, trading or broad account-administration tools
as enabled defaults. They add account setup and irreversible effects without
helping the first project experience.

## Implementation order and acceptance gates

### P0: Finish the recovery boundary for macOS projects

Implement WP-R05 from REVERSE-TOOL-UPGRADE-PLAN before describing VOID as a
general coding-project undo tool. Start with explicit app-managed files in a
selected workspace; handle binary bytes, file modes, missing paths, path escapes,
symlinks, quota failures and conflicting writes. Capture must complete before
dispatch. Crash gaps remain unknown until reconciled. Then add Git worktree
checkpoints and prove that ignored secrets and unrelated changes are preserved.

Gate: real filesystem tests, interruption before/after writes, restart recovery,
human edits, repeated Undo and stale approvals. No green badge from a snapshot
alone. A general terminal is not automatically covered by a file adapter.

### P1: Project wizard and readiness repair

Create a persistent project identity, explicit folder permission and selected
pack. Display account, executable, tool-catalog and recovery status separately.
Each failure should offer one relevant action: reconnect, select a folder,
install the pinned runtime, or choose a supported operation. Remember successful
steps and make rerunning setup idempotent. Start with managed-document projects;
enable filesystem packs only after P0's gate passes.

Gate: a fresh macOS account reaches its first useful task without a terminal;
cancelled OAuth, offline providers, missing tools and repeated setup preserve
existing work. Measure completion rate and steps rather than inventing a promised
setup time. An imported key does not count as a successful model/tool task.

### P2: Small curated tool catalog

Add an MCPB-compatible installer after validating archive paths, package size,
platform/runtime compatibility, digest/signature and publisher provenance.
Pin releases and retain a last-known-good version. Installation must be atomic;
configuration must not execute before acceptance. Discoverable packages remain
unverified until checked. Use the bundled Node runtime where compatible;
provision Python or other runtimes only for packs that need them.

Gate: malicious archive traversal, invalid signature, interrupted download,
wrong architecture, incompatible version and failed update leave the working
installation intact. Uninstall revokes its execution and preserves project data.

### P3: Load tools on demand and control spend

Keep a compact capability index, then load schemas for the chosen task. Tool
selection remains subject to deterministic permissions; a model cannot enable
its own access. Show actual provider usage, source of estimates and per-project
limits. Make expensive models an explicit selection. Keep GLM 5.3 Free as the
preferred TokenRouter model while available; never imply its price is guaranteed.

Gate: compare the same tasks with full catalogs versus selected toolsets. Record
input tokens, latency, success rate and missed-tool retries. Do not trade lower
token counts for silent permission expansion or untraceable tool execution.

### P4: Recovery center and truthful release criteria

Show the operation, executor, captured scope, affected resources, recovery plan,
conflicts and irreversible residual effects in one place. Add cross-operation
jobs only with durable checkpoints and dependency-aware ordering. Connect each
marketing promise to RECOVERY-COVERAGE.md and an executable release test.

Gate: no announcement of universal readiness until every advertised supported
operation has apply, restart, verify and negative-case evidence. Classify external
notifications, deployments already serving traffic and data disclosure accurately.
Mac signing/notarization, clean-machine installation, accessibility and operational
support are separate release gates. iOS starts after these macOS gates.
