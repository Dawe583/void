# Swarm state

One line per track, updated by the track owner. Read before you start and after every land.
Parent sweeps this file into commit messages.

## Wave 1 (CLOSED, all committed)

| track | owner | status | commit |
| ----- | ----- | ------ | ------ |
| postgres connector | pg-connector | done | b7c1b919 |
| snapshot store | snapshot-store | done | 698e9bc2 |
| s3 connector | s3-connector | done | 662cbe62 |
| void replay cli | replay-cli | done | 6e36fb25 |
| blast radius probes | probes | done | b1c28f5e |

Workspace: 240 tests green (registry 28, ledger 23, policy 39, proxy 44, connectors 49, cli 57).

## Wave 2 (ACTIVE)

| track | owner | status | depends on |
| ----- | ----- | ------ | ---------- |
| measured blast radius in forwarder | proxy-probes | landed: probe provider in forward/tools.ts, proxy blast dispatcher, 52 proxy tests green | probes/registry exports |
| connector registry + manifest | connector-registry | landed registry.ts, manifest.ts and tests; connectors typecheck, connectors tests, cli tests green | wave 1 exports |
| approvals end to end | approvals-wiring | in progress: designing ApprovalBroker and proxy pump API | hold.ts + channels |
| control-plane API | api-server | landed apps/control-plane/api server, tests, package scripts; ApprovalBroker is injectable with 503 fallback | ledger feed + approvals decision shape |
| connector e2e round trip | e2e-connectors | landed scripts/src/e2e-connectors.mjs and scripts/src/e2e-connectors.test.mjs; scenario, own test, and connectors typecheck pass | connector-registry manifest.ts |

## Rules

1. Update your row (status + one sentence) before you end each work session.
2. Message a sibling directly when you land a file they depend on.
3. The contract in packages/connectors/README.md is frozen: if you must change a shape,
   message the parent AND every sibling in this table, and update the README in your commit.
4. Never edit another track's files. The paths are yours alone.
