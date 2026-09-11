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

## Web deployment on Vercel

The web application and backend run in the existing `void-tui` Vercel project,
team `sitespot`. No Mac, Raspberry Pi or separate VOID server is required.
Nitro builds the HTTP API into Vercel Functions. Vercel Workflow runs agent
turns and durable approval waits. Neon, provisioned through Vercel Marketplace,
stores sessions, transcripts, configuration and the signed ledger.

The `void` project is the separate reference landing site and is untouched.

Server environment variables:

- `DATABASE_URL`: supplied by the Neon integration.
- `VOID_CONTROL_TOKEN`: single-operator access token, at least 32 characters.
- `VOID_SECRET_KEY`: 32 random bytes, base64, for AES-256-GCM secret encryption.
- `VOID_SIGNING_KEY`: Ed25519 PKCS8 DER, base64, stable across deployments.
- Optional `AI_GATEWAY_API_KEY`: otherwise Vercel OIDC authenticates AI Gateway.

`node --env-file=.env.local scripts/src/provision-cloud.mjs` installs the schema
and sets the server secrets using Vercel environment management. Its local secret
files are ignored and private. The operator access token is in `.env.void-access`;
never share the signing or encryption keys. Enter the access token in the web
connection form. Authentication uses Secure, HttpOnly, SameSiteStrict cookies.
This beta is a single-operator workspace, not a multiuser RBAC product.

The default cloud provider is Vercel AI Gateway. A model catalog can be available
before the account is authorized to generate. If Gateway reports
`customer_verification_required`, complete account verification in Vercel or
enter a provider API key through Provider settings. Custom keys and tool-server
credentials are encrypted before database storage. Prompts and tool results are
sent to the selected provider.

Connect an HTTPS MCP server in Tool server and policy. It is the system the
agent operates on, not an external VOID runtime. Without tools, sessions support
chat only. Tool names can map explicitly to VOID registry IDs; unknown or
unclassified tools are denied. Target facts are operator declarations, never
invented measurements. Policy changes apply to new sessions.

One model session runs at a time, bounded to 20 model turns per message and 32
tools per batch. The recent session list shows 100 sessions; transcripts retain
200 visible events. Approvals survive function restarts. A dispatched tool is
never retried after an ambiguous interruption. Cancellation stops further calls;
an already dispatched mutation may finish and is recorded. Signed ledger rows
are protected from updates/deletes by a database trigger and verified on read.

Cloud API records actual `execute:completed` / `execute:failed` outcomes in
addition to authorization. Arbitrary remote MCP servers do not provide before
images, so their replay action explicitly refuses an uncaptured inverse. Local
connector replay remains available as described below.

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

Verification includes the full `pnpm check` (487 tests passing), whole-product approval arc, final
stdio/HTTP product sweep and connector replay sweep. PostgreSQL cascade behavior
also runs on PGlite's actual SQL engine with foreign-key constraints and unrelated
rows. Browser QA covers 320, 375, 390, 430, 768 and 1280 pixel widths, both themes,
a real SDK session behind an explicitly labeled local model test double, signed
ledger detail, dependency tracing and unavailable snapshot refusal. The cloud safety sweep additionally uses the real provisioned Neon database and
disposable HTTP tool/provider services. Both approval outcomes, immutable signed
rows and interruption refusal pass. Vercel Workflow dispatch was exercised on
deployed Vercel Functions; live generation encountered Gateway account verification.
It does not claim a completed paid-model run or validation of customer buckets.

## Remaining roadmap

This is not completion of every work package in the master plan. Native Codex,
Claude Code and OpenCode process adapters, PTY embedding, desktop packaging,
OS keychain persistence, token streaming, multi-agent
orchestration, production KMS and a multiwriter ledger backend remain open.
Local sessions/transcripts are bounded in memory; cloud sessions persist in Neon.
Only one model session runs at a time. Speculative execution is not supported.
