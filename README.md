# VOID

VOID is an accountability and reversibility layer for AI agents.

It sits between an MCP capable agent and the tools the agent can write to. For each write, VOID classifies how reversible the call is, applies a policy, and appends a signed hash chained ledger entry. Later, operators can inspect the feed, verify the chain, attest a slice, trace taint, and replay true inverses when a connector has captured enough state.

## What VOID protects

VOID does not make an agent safe by trusting the model. It protects the write path.

1. Intercept the tool call.
2. Classify the call as R0, R1, R2, or R3 from registry cases and target facts.
3. Apply policy.
4. Allow, deny, or hold.
5. Record the decision in the ledger before the write proceeds in fail-closed posture.
6. Use connector snapshots and manifests for replay where a true inverse exists.

## Reversibility classes

| Class | Meaning | Usual posture |
| ----- | ------- | ------------- |
| R0 | Fully reversible with a direct inverse. | Allow with ledger. |
| R1 | Reversible with a trace or before image. | Allow for small blast radius, hold for large blast radius. |
| R2 | Mitigable only. | Hold or deny. |
| R3 | Irreversible. | Hold or deny. |

## Two operating postures

| Posture | Behavior |
| ------- | -------- |
| `fail-closed` | The default. Unknown tools, unclassified calls, invalid policy, ledger failure, and internal errors deny. Availability is traded for safety. |
| `observe` | Forward calls and record decisions where possible. Non-allow verdicts are printed to stderr. Use this only for trials and shadow runs. |

## Five-minute local path

Use Node.js 24 or newer and `pnpm install --frozen-lockfile`. Packages are private at version 0.1.0. Start the agent GUI with `pnpm gui`, or run the native macOS app with `pnpm desktop:setup` followed by `pnpm desktop`. Connect a provider in Settings; managed documents and captured Undo work without a separate tool server. Build the installer with `pnpm desktop:build`; see [the beta runbook](docs/BETA.md) for agent configuration, terminal controls, Vercel deployment and the reviewed feature boundaries.

The GUI uses the shared React/TypeScript client in `apps/control-plane/ui`.
`pnpm gui` builds it before starting the local API. For frontend development,
run `node apps/control-plane/api/server.ts` and `pnpm dev:web` in separate
terminals. `pnpm build:web` creates the production assets used by Vercel and
the desktop bundle. New conversations default to **TokenRouter / GLM 5.3 Free**;
connect a server-side provider key in Settings or set `TOKENROUTER_API_KEY`.
Existing conversations keep their original provider and model.

From the repository root, start with the simulated hold moment:

```sh
node scripts/src/moment.mjs
```

You should see one denied Postgres delete, one approved Postgres delete, and the lines an agent would read after a hold resolves.

Run a real proxy process against the fixture MCP server:

```sh
node packages/proxy/bin/void-proxy.mjs --upstream node --args fixtures/e2e-server.mjs --policy fixtures/e2e-policy.yaml --ledger-dir /tmp/void-ledger --workspace demo
```

That command waits on stdin because it is an MCP stdio server. Put an MCP client in front of it. With the fixture policy, `echo` is allowed and `orders_delete` is held.

Classify a fixture transcript without running the proxy:

```sh
node packages/cli/bin/void.mjs classify --transcript fixtures/session.jsonl --facts fixtures/facts.json
```

Run the final local product sweep. It creates a temp ledger, reaches a hold, reads the feed, verifies the chain, checks taint, writes an attestation, detects tamper, and exercises the HTTP upstream path when the current wave exposes it:

```sh
node scripts/src/e2e-final.mjs all
```

For connector replay behavior, including drift refusal, run:

```sh
node scripts/src/e2e-connectors.mjs
```

The whole-product arc drives every surface in one story: the SDK client holds a destructive call, a control-plane operator approves it over HTTP, the upstream executes it, and the ledger arc closes through the void CLI:

```sh
node scripts/src/e2e-arc.mjs all
```

A local smoke benchmark of the proxy write path:

```sh
node scripts/src/bench.mjs --scale 200
```

## Operator commands

The development binary is `node packages/cli/bin/void.mjs`. Packaged releases will expose the same handlers as `void`.

| Need | Command surface | Current note |
| ---- | --------------- | ------------ |
| Live feed | `feed --ledger <ledger-file> [--json] [--follow]` | Verifies the chain before printing. |
| Approval status | `approvals [--dir <state-dir>]` | Reads pending holds from the approvals state directory. |
| Decide a hold | `approve <holdId> --by <actor> [--reason <text>] [--dir <state-dir>] [--deny] [--json]` | Queues a durable decision file the running proxy consumes. |
| Approvals overview | `approvals --dir <state-dir>` | Lists what the proxy surfaced in the state dir. |
| Replay | `replay --ledger <ledger-file> --snapshot-dir <dir> --seq <n> [--dry-run]`, `replay --list-connectors` | The binary loads the static connector set (postgres, s3). Executors come from host environment variables, so a dry-run plan works everywhere and apply fails with a typed error when an executor is absent. |
| Taint | `taint --ledger <dir-or-file> --seq <n> [--depth <n>] [--json]` | Builds graph edges from the verified ledger. |
| Verify | `verify --ledger <dir-or-file> [--attestation <path>]` | Recomputes body hashes, links, and signatures. |
| Policy packs | `packages/policy/packs/strict.yaml`, `balanced.yaml`, `dev.yaml` | Ready-made policies loaded through `loadPack` in the policy package. `strict` allows only R0, `balanced` holds R2 and denies R3, `dev` holds every R3. |

## Package map

| Package | Owns |
| ------- | ---- |
| `@void/registry` | Registry data, preconditions, evaluation, and declared facts. It imports nothing. |
| `@void/ledger` | Canonical JSON, entry hashes, JSONL store, signing, feed, taint, verification, and attestations. |
| `@void/policy` | YAML policy loading, decisions, holds, approval broker, and approval channels. |
| `@void/proxy` | MCP session plumbing, stdio and HTTP upstream transports, forwarding, interception, and approval pumping. |
| `@void/connectors` | Connector registry, Postgres logic, S3 logic, probes, snapshots, and manifests. |
| `@void/cli` | Development command handlers and terminal render models. |
| `@void/workbench` | Provider discovery, bounded agent sessions and the shared GUI/CLI model loop. |
| `@void/sdk` | In-process client wrapper for app builders: VoidClient, holdHandle, typed errors. |

## Beta scope

See [docs/BETA.md](docs/BETA.md) for supported features, verification evidence,
remote authentication, runtime configuration and remaining roadmap work.
The web app and backend run on Vercel, with Workflow and a Neon database.
Model generation requires an active Vercel AI Gateway account or a provider key.
Native agent adapters and automatic snapshot capture for arbitrary MCP tools
are not included in this beta.

## More docs

- `docs/CONTEXT.md`: authoritative product context and vocabulary.
- `docs/DECISIONS.md`: decision log.
- `docs/STANDARDS.md`: coding, test, safety, and repository rules.
- `docs/OPERATIONS.md`: operator runbook.
- `docs/SDK.md`: SDK release candidate surface.
- `docs/TESTING.md`: package test commands and test rules.
- `packages/policy/README.md`: policy pack contents and loading rules.
- `scripts/src/bench.mjs`: local smoke benchmark (forwarding, ledger append, classification).
