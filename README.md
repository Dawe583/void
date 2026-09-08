# VOID

VOID is a process that sits between an AI agent and the tools it can write to. For each tool call, it classifies how reversible the call is, applies policy, and records a signed entry in an append only ledger. Later, VOID can replay true inverses for calls that have them.

## Vocabulary

- R0: fully reversible, with a direct inverse.
- R1: reversible with a trace or before image.
- R2: mitigable only, with compensation but no true inverse.
- R3: irreversible, so policy must hold or deny by default.

## Packages

| package | owns | tests |
| ------- | ---- | ----- |
| `@void/registry` | Reversibility data, preconditions, case evaluation, and facts conversion. | 28 |
| `@void/ledger` | Canonical JSON, hash chain, signing, append only stores, and verification. | 19 |
| `@void/proxy` | MCP session plumbing, stdio transport, request relay, notification relay, and tool call forwarding. | 36 |
| `@void/policy` | YAML rules, decisions, blocking holds, and CLI channel rendering. | 39 |
| `@void/connectors` | Connector ids, connector lookup, and duplicate id checks. | 3 |
| `@void/cli` | `void` invocation parsing, classify command support, and the terminal render model. | 47 |

## Quickstart

Install dependencies, if the root owner has not already done this:

```sh
pnpm install
```

Run the package tests:

```sh
cd packages/registry && node --test src/evaluate.test.ts src/facts.test.ts src/index.test.ts
cd packages/ledger && node --test src/index.test.ts
cd packages/proxy && node --test src/forward/forward.test.ts src/forward/tools.test.ts src/index.test.ts src/relay/notifications.test.ts src/relay/requests.test.ts src/session.test.ts src/transport/stdio.test.ts
cd packages/policy && node --test src/channels/cli.test.ts src/channels/slack.test.ts src/hold.test.ts src/index.test.ts src/rules.test.ts src/skeptics.test.ts
cd packages/connectors && node --test src/index.test.ts
cd packages/cli && node --test src/classify.test.ts src/index.test.ts src/tui/tui.test.ts
```

Run the moment script:

```sh
node scripts/src/moment.mjs
```

Run classify against the fixture transcript:

```sh
node packages/cli/bin/void.mjs classify --transcript fixtures/session.jsonl --facts fixtures/facts.json
```

Open the control plane GUI file:

```sh
open apps/control-plane/web/index.html
```

## Status

- WP-00 done: context pack, package scaffold, and package README contracts exist.
- WP-01 done in part: proxy stdio transport and core message relay code exist.
- WP-02 pending: Streamable HTTP, progress, cancellation, and reconnect are not done.
- WP-03 done: ledger canonical form, signing, append only store, and verification exist.
- WP-04a done: registry runtime, evaluator, and declared facts conversion exist.
- WP-04b done in part: the registry data has 89 entries, but expansion remains ongoing work.
- WP-05 done: policy loader, matcher, decisions, blocking hold, and CLI channel exist.
- WP-06 pending: the Postgres connector is not implemented.
- WP-07 pending: the S3 connector is not implemented.
- WP-08 pending: probes and blast radius computation are not implemented.
- WP-09 done in part: invocation parsing and classify exist, while run, ledger verify, replay, and attest are still pending.
- WP-09b done: terminal render model, capability detection, previews, and safety tests exist.
- WP-10 pending: control plane API is not implemented.
- WP-11 done in part: a static control plane GUI exists at `apps/control-plane/web/index.html`.
- WP-12 pending: taint graph is not implemented.
- WP-13 pending: attestation and standalone verifier are not implemented.
- WP-14 pending: SDK wrap is not implemented.
- WP-15 pending: hardening, docs, and release work remains open.

## More docs

- `docs/CONTEXT.md`: authoritative product context and vocabulary.
- `docs/DECISIONS.md`: the seven starting decisions.
- `docs/STANDARDS.md`: coding, test, safety, and repository rules.
- `docs/TESTING.md`: package test commands and test rules.
