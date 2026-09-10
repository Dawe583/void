# VOID operations runbook

This runbook is for the dev-tier product in this repository.

## Policy grammar quick table

Policy files are YAML. Version 1 uses ordered rules. First match wins.

| Field | Required | Shape | Meaning |
| ----- | -------- | ----- | ------- |
| `version` | yes | `1` | Policy grammar version. Unknown versions fail closed. |
| `rules` | yes | list | Ordered rules. Put narrow rules before broad rules. |
| `match.class` | no | `r0`, `r1`, `r2`, `r3`, or list | Reversibility class after registry evaluation. |
| `match.tool` | no | string or list | Tool id, for example `postgres.row.delete`. |
| `match.connector` | no | string or list | Connector id, for example `postgres` or `s3`. |
| `match.workspace` | no | string or list | Workspace name. |
| `match.blast_radius` | no | `{ lt: n }` only; other operators are load errors | Measured blast radius comparison. |
| `decision` | yes | `allow`, `deny`, or `hold` | What the proxy does. |
| `seconds` | for hold | whole number from 1 to 900 | Hold timeout. |
| `notify` | no | `cli`, `slack`, or list | Approval channels. |
| `rationale` | recommended | string | Human reason shown in denials and holds. |

Unknown keys and unknown values are load errors. A missing or invalid policy denies startup in fail-closed posture.

Starter shape:

```yaml
version: 1
rules:
  - match:
      class: r0
    decision: allow
    rationale: fully reversible calls can proceed after ledger append
  - match:
      class: r1
      blast_radius: { lt: 100 }
    decision: allow
    rationale: small reversible writes are below the hold line
  - match:
      class: [r2, r3]
    decision: hold
    seconds: 120
    notify: [cli]
    rationale: visible or permanent damage needs a human decision
  - match: {}
    decision: deny
    rationale: deny anything the policy did not name
```

## Ledger directory layout

The dev-tier ledger is JSONL.

```text
<VOID_LEDGER_DIR>/
  <workspace>.jsonl
  attestations/
    <head-seq>.json
```

If `VOID_LEDGER_DIR` is not set, the default ledger directory is under the user's home directory. The development private key is not in the ledger directory by default. It comes from `VOID_SIGNING_KEY` or from the local development key path managed by `devKeyProvider`.

Each JSONL line is one stored entry with:

- workspace
- sequence number
- body, containing time, tool, class, decision, and argument digest
- previous hash
- entry hash
- key id
- algorithm
- signature

The ledger stores argument digests, not payloads.

## Fail-closed guarantees

In `fail-closed` posture, VOID denies when it cannot keep the safety contract.

It denies on:

- unknown tool
- unclassified call
- unreadable or invalid policy
- ledger append failure
- invalid facts file
- internal proxy error
- missing ledger directory at startup

It also refuses to start when the fail-closed posture has no ledger directory. A call cannot forward without its decision being recorded.

## What fail-closed does not guarantee

Fail-closed is not an identity system, a backup product, or a production KMS.

It does not guarantee:

- that declared facts are true
- that a human approval was authenticated
- that a local JSONL store is safe for multiple writers
- that R2 or R3 calls can be undone
- that a replay is safe after target drift
- that connector credentials exist
- that production Postgres or S3 is wired by default

Use it as a safety gate for the agent write path. Do not treat it as proof that the target system is healthy.

## Verify a ledger or export

Use `verify` before trusting any feed, replay, taint graph, or attestation.

```sh
node packages/cli/bin/void.mjs verify --ledger <ledger-dir-or-file>
```

To verify a ledger against an attestation:

```sh
node packages/cli/bin/void.mjs verify --ledger <ledger-dir-or-file> --attestation <attestation-json>
```

The verifier checks sequence order, previous hash links, body hashes, and signatures when a key is available. A failure exits non-zero and names the first bad entry.

## Attestation flow

An attestation is a signed summary of a ledger slice. It lets a reviewer check a head sequence, head hash, entry count, Merkle digest, key id, algorithm, and signature without trusting a VOID process.

Operational flow:

1. Stop or quiesce the write path for the slice you want to attest.
2. Verify the ledger.
3. Generate the attestation document with the ledger package.
4. Store it under the ledger directory.
5. Send the ledger slice, attestation, and public key material to the reviewer.
6. The reviewer runs verify with the attestation path.

The local product sweep exercises this path:

```sh
node scripts/src/e2e-final.mjs all
```

## Feed

The feed prints only after the ledger verifies.

```sh
node packages/cli/bin/void.mjs feed --ledger <ledger-file>
```

Use JSON for scripts:

```sh
node packages/cli/bin/void.mjs feed --ledger <ledger-file> --json
```

Use `--follow` for a live local view. It stays attached until the process is closed.

## Approvals

The proxy surfaces held calls through a per-run state directory. One proxy owns a directory at a time.

Start the proxy with a state directory:

```sh
node packages/proxy/bin/void-proxy.mjs --upstream node --args fixtures/e2e-server.mjs --policy fixtures/e2e-policy.yaml --ledger-dir /tmp/void-ledger --approvals-dir /tmp/void-approvals --workspace demo
```

Without `--approvals-dir`, the proxy defaults to `$VOID_APPROVALS_DIR`, then `~/.void/approvals/<workspace>`.

List pending holds from a second terminal:

```sh
node packages/cli/bin/void.mjs approvals --dir /tmp/void-approvals
```

Approve or deny a hold:

```sh
node packages/cli/bin/void.mjs approve <holdId> --by <actor> --reason <text> --dir /tmp/void-approvals
node packages/cli/bin/void.mjs approve <holdId> --by <actor> --deny --dir /tmp/void-approvals
```

The CLI writes a decision file and prints that the decision is queued. The running proxy polls the directory and resolves the hold. The CLI cannot know whether the proxy was still running when the decision landed, so it never claims the release.

State directory layout:

```text
<approvals-dir>/
  pending.json
  proxy.lock
  decisions/
    <nonce>.json
```

Recovery: `proxy.lock` exists while a proxy owns the directory. If the proxy crashed, remove the stale `proxy.lock` by hand and start a new proxy. A live second proxy refuses the directory with `ApprovalStateInUseError` rather than sharing state.

Every hold carries a per-hold nonce. A stale decision file cannot be replayed onto a later hold with the same id after a restart.

In this repository, approvals are development surfaces. They are not authenticated. In process, the SDK exposes hold handles that can decide a pending hold through the approval broker, and the local control-plane pages can render and decide them over HTTP for development use.

## Replay and drift refusal

Replay is only valid for R0 and R1 calls with a captured inverse. The connector must find a snapshot manifest entry that matches the ledger argument digest and tool.

The binary wires the static connector set. Check what is wired and which executors are available:

```sh
node packages/cli/bin/void.mjs replay --list-connectors
```

Executors come from the host environment. For Postgres, set `VOID_PG_URL` before apply. Without it, apply fails with a typed `ExecutorNotConfigured` error that names the missing variable. S3 replay additionally needs a host adapter and persisted replay metadata, which the local binary does not write yet. The connector end-to-end script proves replay and drift refusal in process:

```sh
node scripts/src/e2e-connectors.mjs
```

Drift refusal means the current target no longer matches the captured before image. Operationally:

1. Do not retry the same replay blindly.
2. Inspect the drift report.
3. Decide whether the later human or system change is now the source of truth.
4. If the original change still needs rollback, create a new manual plan against current state.
5. Record that manual action separately.

VOID refuses drift to avoid overwriting later human work.

## Taint

Taint uses the verified ledger to show what later calls depend on a prior call.

```sh
node packages/cli/bin/void.mjs taint --ledger <ledger-dir-or-file> --seq <n>
```

Use JSON for tooling:

```sh
node packages/cli/bin/void.mjs taint --ledger <ledger-dir-or-file> --seq <n> --json
```

Data edges require `outputDigest` on a producing ledger entry. Entries without output digests can still produce resource edges.

## Policy packs

Three ready-made policies ship in `packages/policy/packs`. Load them with `loadPack` from the policy package, or point the proxy at the YAML file directly.

- `dev.yaml`: R0 to R2 allowed, every R3 held for 60 seconds with CLI notification.
- `balanced.yaml`: R0 and R1 allowed, R2 held for 300 seconds, R3 denied.
- `strict.yaml`: only R0 allowed, everything else denied.

Packs fail closed: a broken pack file is a load error, never a silent fallback to a default policy.

## Control-plane pages

The local control-plane serves dashboard pages that poll the feed, the approvals surface, and chain verification:

```sh
node --input-type=module -e "import { listenControlPlane } from './apps/control-plane/api/server.ts'; const h = await listenControlPlane({}); console.log(h.port);"
```

The pages are development surfaces with no authentication. Approve and deny buttons post to the decision endpoint of the running server instance.

## Local benchmark

The smoke benchmark measures the proxy write path on this machine. Its numbers are smoke-grade, not release benchmarks:

```sh
node scripts/src/bench.mjs --scale 200
```

## Proxy startup

Stdio fixture command:

```sh
node packages/proxy/bin/void-proxy.mjs --upstream node --args fixtures/e2e-server.mjs --policy fixtures/e2e-policy.yaml --ledger-dir /tmp/void-ledger --workspace demo
```

HTTP upstream builds in wave 4 use this shape:

```sh
node packages/proxy/bin/void-proxy.mjs --transport http --upstream-url <url> --policy <policy-yaml> --ledger-dir <ledger-dir> --workspace <workspace>
```

Use `observe` only for trials:

```sh
node packages/proxy/bin/void-proxy.mjs --upstream node --args fixtures/e2e-server.mjs --policy fixtures/e2e-policy.yaml --posture observe --workspace demo
```
