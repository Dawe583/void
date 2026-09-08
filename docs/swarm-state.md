# Swarm state

One line per track, updated by the track owner. Read before you start and after every land.
Parent sweeps this file into commit messages.

## Waves 1-3 (CLOSED, committed)

Wave 1: postgres connector b7c1b919, snapshot store 698e9bc2, s3 connector 662cbe62, replay cli 6e36fb25, probes b1c28f5e.
Wave 2: proxy-probes e84e6657, connector-registry f9790f24, approvals c327656e, api-server eb776cf9, e2e-connectors 371c4d2c.
Wave 3: taint-a 7fd9d6b3, http-transport 1b9176d7, taint-b 8644f817, registry-batch cedff44a, attestation a6150688.

Workspace: 366 checks green (registry 28, ledger 39, policy 44, proxy 60, connectors 57, cli 66, control-plane 11, e2e 14+5+6+2). Registry: 163 entries.

## Wave 4 (ACTIVE)

| track | owner | status | depends on |
| ----- | ----- | ------ | ---------- |
| SDK wrap | sdk-wrap | landed: packages/sdk exports VoidClient, holdHandle and typed errors; sdk typecheck and 6 node:test checks pass | runProxy + broker shapes |
| HTTP bin wiring | http-bin-wiring | landed: runProxy supports transport stdio or http; void-proxy accepts --transport stdio|http and --upstream-url for http; stdio warns if --upstream-url is supplied | transport/http.ts landed |
| hardening pass | hardening | landed fail-closed guards: JSON-RPC batch and null id reject, inbound ceiling, no payload echo, SIGTERM/SIGINT hold drain, workspace sanitization, key mode checks, sequential ledger appends, feed parse exit | all packages |
| final e2e sweep | e2e-final | landed scripts/src/e2e-final.mjs, test, and HTTP fixture; script PASS with NOTE for missing approve command and replay drift surface | CLI surfaces + http flags |
| docs + changelog + release | docs-release | landed README, CHANGELOG, operations runbook, SDK docs, SDK README, and docs release test; verification complete with one proxy typecheck blocked by sibling hardening test syntax | everything |

## Rules

1. Update your row (status + one sentence) before you end each work session.
2. Message a sibling directly when you land a file they depend on.
3. Contracts frozen: packages/connectors/README.md, packages/proxy/docs/interface.md.
4. Never edit another track's files. The paths are yours alone.
5. e2e-final: flag surfaces from http-bin-wiring land on the blackboard; skip a scenario with an honest NOTE if a surface is missing, never fake it.
