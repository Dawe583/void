# Swarm state

One line per track, updated by the track owner. Read before you start and after every land.
Parent sweeps this file into commit messages.

## Waves 1-4 (CLOSED, committed)

Wave 1: pg b7c1b919, snapshot 698e9bc2, s3 662cbe62, replay 6e36fb25, probes b1c28f5e.
Wave 2: proxy-probes e84e6657, connector-registry f9790f24, approvals c327656e, api-server eb776cf9, e2e-connectors 371c4d2c.
Wave 3: taint-a 7fd9d6b3, http 1b9176d7, taint-b 8644f817, registry-batch2 cedff44a, attestation a6150688.
Wave 4: store race 6f9313fe, e2e-final a44ba324, http-bin 1ec1894b, sdk 9a5c027c, hardening ecdd151f, docs cac57d7f.

Workspace: 346 package checks + 26 e2e checks green. Registry: 163 entries. HEAD cac57d7f.

## Wave 5 (ACTIVE, 8 tracks)

| track | owner | status | depends on |
| ----- | ----- | ------ | ---------- |
| void approve CLI + broker state dir | approve-command | starting | approvals.ts + approval-loop.ts (owned) |
| replay connector registry | replay-registry | starting | connectors/registry.ts + manifest.ts |
| UI wiring to real API | ui-wiring | complete: 4 live pages, app.js, explicit JS allowlist; parent verified typecheck and 12 UI tests pass | parent browser check; server security fixes owned by adversarial-2 |
| policy packs (strict/balanced/dev) | policy-packs | done: three YAML packs, typed loader, README and index export; parent verified typecheck 0 and 28/28 tests | rules.ts grammar |
| benchmark harness | bench | landed: 3 scenarios, isolated signer fork, dynamic registry; parent ran 3 tests (3 pass, 0 fail), both syntax checks and scale 200 table | runProxy + jsonlStore + registry |
| adversarial pass 2 | adversarial-2 | landed: 16 findings (7 high), five targeted fixes; parent-run security 8/8, ledger 49/49, proxy 79/79 and both typechecks pass | whole tree |
| registry batch 3 (azure/gcp/vercel/...) | registry-batch3 | landed 107 new entries, 270 total, 72 facts; registry and CLI typechecks pass, registry tests 10/10 and CLI classify 13/13 pass; final CLI batch3 fixture test pending | parent test runner |
| packaging + release polish | packaging | landed: private 0.1.0 metadata, root bins, RELEASE.md, interface appendix, 15 metadata tests; native verification blocked by command runner | parent-run tests and typechecks |

| replay registry | replay-registry | verified by parent: 21 replay tests pass, CLI and connectors typechecks pass; static Postgres planning, typed executor errors, --list-connectors and drift report; live binary adapters remain unavailable | connector registry + local snapshots |

## Rules

1. Update your row (status + one sentence) before you end each work session.
2. Message a sibling directly when you land a file they depend on.
3. Contracts frozen: packages/connectors/README.md, packages/proxy/docs/interface.md.
4. Never edit another track's files. Ownership: approve-command owns approvals.ts + approval-loop.ts; replay-registry owns replay.ts; ui-wiring owns web/ + one server.ts line; adversarial-2 owns security-notes.md + unowned files only.


## Wave 5 (CLOSED, 8 tracks committed)

packaging 9d4948de, ui-wiring 72fec897, bench a72e0ee3, adversarial-2 5b88062d,
policy-packs 284de440, replay-registry 5b47ba20, registry-batch3 7bb7d77e,
approve-command 0d1655b9, e2e notes closed 50f5e8be (root).

Final state: registry 270 entries; both e2e-final NOTEs closed with real approve
and drift moments; 8/8 moments pass; full package suites green (registry 32,
ledger 49, policy 73, proxy 79, connectors 57, cli 95, sdk 6, control-plane 23,
scripts 30 from repo root).
