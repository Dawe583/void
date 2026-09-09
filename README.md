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

This repository already has dependencies installed in the current workspace. Release packaging is still private at version 0.0.0, so the public install command is not final yet. If dependencies are missing, the root owner runs the install step because this repo protects the lockfile.

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
| `@void/sdk` | In-process client wrapper for app builders: VoidClient, holdHandle, typed errors. |

## Honest limitations

- Packages are still private at `0.0.0`. The public install and publish flow is not complete.
- Development signing uses `devKeyProvider`, backed by `VOID_SIGNING_KEY` or a local ed25519 key under the user home directory. Production KMS is an interface, not wired here.
- The default ledger store is local JSONL. It is tamper evident and fsynced, but it is a dev-tier single-writer store. There is no real Postgres ledger store wired by default.
- Postgres and S3 connector logic exists, but no real customer Postgres or S3 account is wired by default. Local proof uses fixtures and fakes.
- Approvals are not authenticated in this repo. The CLI and SDK paths are development surfaces, not a hosted identity system.
- Blocking holds pause the tool call. Speculative execution and provisional receipts are not implemented.
- `void replay` builds inverse plans from captured snapshots, but applying them needs a real executor. The binary refuses with a typed error (for example `ExecutorNotConfigured`) when `VOID_PG_URL` or an S3 adapter is absent. Live drift against a real database is proven only in the local scripts.
- The control-plane server and its pages are local development surfaces with no authentication. Do not expose them beyond localhost.
- Real-browser verification of the control-plane pages is blocked in this development sandbox. The pages are covered by render tests plus a live API check against a real signed ledger.

## More docs

- `docs/CONTEXT.md`: authoritative product context and vocabulary.
- `docs/DECISIONS.md`: decision log.
- `docs/STANDARDS.md`: coding, test, safety, and repository rules.
- `docs/OPERATIONS.md`: operator runbook.
- `docs/SDK.md`: SDK release candidate surface.
- `docs/TESTING.md`: package test commands and test rules.
- `packages/policy/README.md`: policy pack contents and loading rules.
- `scripts/src/bench.mjs`: local smoke benchmark (forwarding, ledger append, classification).
