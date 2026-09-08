# Swarm state

One line per track, updated by the track owner. Read before you start and after every land.
Parent sweeps this file into commit messages.

## Wave 1 (CLOSED, committed)

| track | owner | status | commit |
| ----- | ----- | ------ | ------ |
| postgres connector | pg-connector | done | b7c1b919 |
| snapshot store | snapshot-store | done | 698e9bc2 |
| s3 connector | s3-connector | done | 662cbe62 |
| void replay cli | replay-cli | done | 6e36fb25 |
| blast radius probes | probes | done | b1c28f5e |

## Wave 2 (CLOSED, committed)

| track | owner | status | commit |
| ----- | ----- | ------ | ------ |
| measured blast radius in forwarder | proxy-probes | done | e84e6657 |
| connector registry + manifest | connector-registry | done | f9790f24 |
| approvals end to end | approvals-wiring | done | c327656e |
| control-plane API | api-server | done | eb776cf9 |
| connector e2e round trip | e2e-connectors | done | 371c4d2c |

Workspace: 299 checks green (registry 28, ledger 23, policy 44, proxy 52, connectors 57, cli 57, control-plane 11, scripts e2e 14+5+6+2).

## Wave 3 (ACTIVE)

| track | owner | status | depends on |
| ----- | ----- | ------ | ---------- |
| streamable HTTP transport | http-transport | landed http.ts and http-requests.ts with 8 new tests, proxy typecheck and node --test pass | stdio.ts events, rpc.ts |
| taint graph capture | taint-a | landed graph.ts and capture.ts; shape published below; ledger package typecheck and tests pass | ledger entries, feed.ts |
| taint query + void taint | taint-b | landed query.ts and void taint wiring; ledger and cli typecheck pass, own tests pass; full cli suite blocked by registry-batch expected count drift | taint-a graph shapes |
| attestation + standalone verifier | attestation | landed attest.ts, verify.ts and void verify; ledger and cli typecheck and tests pass | store.ts, feed.ts chain core |
| registry expansion batch 2 | registry-batch | landed: registry has 163 entries, 74 new in batch 2, 74 fact rows, registry tests and cli classify test pass | frozen fact vocabulary |


### WP-12 taint shapes

Published by taint-a for taint-b.

```ts
type TaintGraph = { nodes: Map<string, TaintNode>; edges: readonly TaintEdge[] };
type TaintNode = { digest: string; seq: number; tool: string; klass: string; decision: string; at: string };
type TaintEdge = { from: string; to: string; kind: "resource" | "data"; via: string };
```

`exportTaint(graph)` returns a JSON string with pinned shape:

```json
{"version":"void.taint.v1","honesty":{"dataEdges":"Data edges require outputDigest on the producing ledger entry. Entries without outputDigest produce resource edges only."},"nodes":[{"digest":"...","seq":1,"tool":"...","klass":"...","decision":"...","at":"..."}],"edges":[{"from":"...","to":"...","kind":"resource","via":"tool:bucket=b:key=k"}]}
```

`verifyTaint(json)` validates that shape and returns `TaintGraph`. `taintFromLedger(dir, workspace)` verifies the JSONL chain through `readLedgerFeed`, then builds the graph. Data edges are emitted only when a producing entry carries `outputDigest` and a later input contains that digest.

## Rules

1. Update your row (status + one sentence) before you end each work session.
2. Message a sibling directly when you land a file they depend on.
3. The contracts in packages/connectors/README.md and packages/proxy/docs/interface.md are frozen.
4. Never edit another track's files. The paths are yours alone.
5. taint-a publishes TaintGraph + exportTaint JSON shape on the blackboard; taint-b builds against the published shape.
