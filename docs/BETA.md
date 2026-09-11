# VOID 0.1 beta

## Supported path

The beta provides an MCP policy proxy, signed JSONL evidence, durable local
approval decisions, a responsive ASCII web control plane, a live terminal inbox,
and an OpenAI-compatible agent workbench shared by the GUI and CLI.

Use Node.js 24 or newer and `pnpm install --frozen-lockfile`. Run `pnpm gui` for
the local control plane. It binds to loopback by default. Set these runtime
variables before starting an agent:

- `VOID_UPSTREAM_COMMAND`: a JSON array containing the MCP executable and arguments.
- `VOID_POLICY_PATH`: a policy YAML file.
- `VOID_LEDGER_DIR`: a durable directory for signed evidence.
- `VOID_FACTS_PATH`: optional declared target facts.
- `OPENROUTER_API_KEY` and optional `VOID_PROVIDER_URL`: provider credentials and
  an OpenAI-compatible API base URL. Alternatively use GUI Provider settings.

The provider model catalog must validate before a session starts. Keys entered
in the GUI stay in runtime memory. The model receives prompts and tool results.
The proxy remains the authorization boundary for every tool request.

For terminal agents run `node packages/cli/bin/void.mjs agent --model <id>`.
For the live operator interface run `node packages/cli/bin/void.mjs watch` with
its ledger options. Press `h` for holds, select with arrows, then `a` or `d` and
`y` to confirm. Noninteractive agent execution denies holds.

## Web deployment

The existing Vercel project is `void-tui` in the `sitespot` team. The separate
`void` project serves the reference landing site and is not this application.
Vercel builds static pages and a stateless API gateway from the repository root.
A persistent runtime owns MCP child processes, approval brokers and local disk.

Configure the runtime with `VOID_CONTROL_TOKEN` (at least 32 random characters),
`VOID_CONTROL_HOST` only when binding beyond loopback, and a durable ledger path.
Put it behind HTTPS. Configure Vercel with the same `VOID_CONTROL_TOKEN` and
`VOID_CONTROL_ORIGIN` set to that HTTPS origin. Keep both in server environment
variables. Enter the shared token in the web connection form; the gateway uses
a Secure, HttpOnly, SameSiteStrict session cookie. It never exposes the upstream
token to JavaScript. This is a single-operator beta, not multiuser identity/RBAC.

Without these environment variables the deployed API returns a setup state.
The frontend can be inspected, but cannot execute agents or claim live evidence.
Do not point production at the disposable preview fixture.

## Replay boundaries

Postgres replay uses `VOID_PG_URL`, a serializable transaction, drift checks and
parent-before-child restoration. The cascade walker follows real foreign keys,
including nested and composite references; cycles are refused. S3 replay uses
`VOID_S3_ENABLED=1`, standard AWS credentials and `AWS_REGION`; an optional
`VOID_S3_ENDPOINT` supports compatible hosts. Conditional writes refuse races.
S3 restoration writes a new version and does not reverse object history.

A host must capture snapshots and produce a manifest through the connector API.
Automatic snapshot capture is not wired into arbitrary MCP upstreams. Manifests
are trusted local inputs, matched by tool and argument digest; ambiguous matches
are refused. This is not a cryptographically bound per-execution snapshot index.
Preview first and restrict snapshot write access. Snapshots are content checked
and written with private file permissions. GUI apply requires explicit
confirmation and signed-ledger validation.

An `allow:resolved` ledger event records authorization, not proof that an upstream
mutation completed successfully. Taint edges describe recorded dependencies,
not a demonstrated causal effect in the external system.

## Review and evidence, 2026-09-11

Review covered registry, ledger, policy, proxy, SDK, connectors, CLI, browser API
and the new workbench. Fixes include missing CLI command handlers, standalone GUI
approval wiring, session hold workspace identity, recursive Postgres capture and
restore ordering, S3 captures surviving restart, conditional S3 writes, private
snapshot permissions, and authenticated remote API forwarding.

Verification includes the full `pnpm check` (482 tests passing), whole-product approval arc, final
stdio/HTTP product sweep and connector replay sweep. PostgreSQL cascade behavior
also runs on PGlite's actual SQL engine with foreign-key constraints and unrelated
rows. Browser QA covers 320, 375, 390, 430, 768 and 1280 pixel widths, both themes,
a real SDK session behind an explicitly labeled local model test double, signed
ledger detail, dependency tracing and unavailable snapshot refusal. It does not
claim validation against a paid model account or customer database/bucket.

## Remaining roadmap

This is not completion of every work package in the master plan. Native Codex,
Claude Code and OpenCode process adapters, PTY embedding, desktop packaging,
OS keychain persistence, token streaming, persistent transcripts, multi-agent
orchestration, production KMS and a multiwriter ledger backend remain open.
Sessions/transcripts are bounded in memory; evidence persists on disk. Only one
model session runs at a time. Speculative execution is not supported.
