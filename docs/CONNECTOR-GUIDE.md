# VOID Connector Guide: Adding a Third Connector

This guide shows how to add a third connector next to the two that exist
today: `postgres` and `s3`. Follow it top to bottom. Each step cites the
exact file and line that defines the shape you must match.

Conventions used below: `file:line` means line `line` in `file`, counted
from 1. All line numbers were read from the current branch. If a cited line
does not match what you see, stop and re-read the source; the source wins.

Related contract: docs/CONTEXT.md, docs/DECISIONS.md, and docs/STANDARDS.md
are authoritative for this repo. Repo rules: ASCII only with no U+2013 or
U+2014, `node:test` only with no test dependencies and no flags, and a
connector never imports another connector.

## 0. The two shapes you mirror

There are two working shapes in the tree. Pick the one closest to your
target, then copy its structure file for file.

Shape A (postgres): SQL write with a parsed statement, a before-image of
rows, an ordered inverse plan, and drift-checked replay in a transaction.

- Parse: `parseStatement` in packages/connectors/src/postgres/parse.ts:33
  turns SQL text into a `ParsedStatement`
  (packages/connectors/src/postgres/parse.ts:8) with a `StatementKind`
  (packages/connectors/src/postgres/parse.ts:6).
- Classify facts: `connectorFacts` in
  packages/connectors/src/postgres/classify.ts:5 maps a statement plus a
  before-image to the `pg.capture.before_image` and `pg.cascade.traversed`
  fact record.
- Capture: `captureBeforeImage` in
  packages/connectors/src/postgres/capture.ts:34 reads the rows that the
  statement would touch into a `BeforeImage`
  (packages/connectors/src/postgres/capture.ts:25) made of `CapturedRow`
  entries (packages/connectors/src/postgres/capture.ts:18) using a
  `CaptureSchema` (packages/connectors/src/postgres/capture.ts:14) of
  `TableSchema` entries (packages/connectors/src/postgres/capture.ts:8)
  through a `QueryExecutor`
  (packages/connectors/src/postgres/capture.ts:4). Cascade discovery uses
  `listCascadeTables` in packages/connectors/src/postgres/capture.ts:58.
- Inverse plan: `buildInverse` in
  packages/connectors/src/postgres/inverse.ts:23 maps each captured row to
  an update step (for `update`) or an insert step in reverse dependency
  order (for `delete`).
- Replay: `applyInverse` in packages/connectors/src/postgres/replay.ts:16
  re-reads current rows with `currentRowsForImage`
  (packages/connectors/src/postgres/inverse.ts:59), compares them with
  `buildDriftReport` (packages/connectors/src/postgres/inverse.ts:36),
  refuses all steps on drift, else runs `updateSql`
  (packages/connectors/src/postgres/inverse.ts:70) or `insertSql`
  (packages/connectors/src/postgres/inverse.ts:80) inside the
  `ReplayExecutor` transaction hooks
  (packages/connectors/src/postgres/replay.ts:5) and returns an
  `ApplyInverseReport` (packages/connectors/src/postgres/replay.ts:11).

Shape B (s3): single object delete with a byte snapshot, an etag drift
check, and a put-back restore.

- Call shape: `S3DeleteCall` in
  packages/connectors/src/s3/classify.ts:6 is `{ bucket, key, versionId? }`.
- Client shape: `S3Client` in packages/connectors/src/s3/classify.ts:26 is
  `getObject` plus `putObject` plus `deleteObject` plus
  `getBucketVersioning`.
- Classify facts: `s3Facts` in packages/connectors/src/s3/classify.ts:66
  returns an `S3FactsResult` (packages/connectors/src/s3/classify.ts:53)
  and records per-probe failures as `ProbeError`
  (packages/connectors/src/s3/classify.ts:40) without inventing an
  `unknown` fact.
- Capture: `captureObject` in packages/connectors/src/s3/capture.ts:34
  reads the bytes with `getObject`, stores them with `SnapshotStore.put`,
  checks the digest with `sha256`
  (packages/connectors/src/s3/capture.ts:71), throws `CaptureFailedError`
  (packages/connectors/src/s3/capture.ts:20) on missing body or digest
  mismatch, and returns a `CaptureObjectResult`
  (packages/connectors/src/s3/capture.ts:12).
- Inverse plus apply: `restoreObject` in
  packages/connectors/src/s3/inverse.ts:14 does the raw `putObject`
  restore; `applyRestore` in packages/connectors/src/s3/apply.ts:31 takes
  an `ApplyRestoreInput` (packages/connectors/src/s3/apply.ts:24), refuses
  with reason `drift` when the live etag moved, and otherwise restores
  from the snapshot store.

Shared stores both shapes use:

- `SnapshotStore` in packages/connectors/src/snapshot/store.ts:11 is
  `put` plus `get` plus `retention`. Digests use `sha256Digest` in
  packages/connectors/src/snapshot/store.ts:30.
- Manifest append plus read for e2e proofs: `manifestWriter` in
  packages/connectors/src/manifest.ts:19 and `manifestReader` in
  packages/connectors/src/manifest.ts:29.
- Probe sets per connector: `pickProbes` in
  packages/connectors/src/probes/registry.ts:25 returns the postgres probe
  pair for `"postgres"` and the s3 probe pair for `"s3"` or `"aws.s3"`.

## 1. Files to create

Create one directory: `packages/connectors/src/<name>/`, where `<name>` is
the new vendor prefix (lowercase, no dots; the part before the first `.`
in the tool name). Create exactly these files:

1. `packages/connectors/src/<name>/classify.ts` - pure fact function.
   Mirror `connectorFacts` (packages/connectors/src/postgres/classify.ts:5)
   for a parsed statement shape, or `s3Facts`
   (packages/connectors/src/s3/classify.ts:66) for a probed remote shape.
2. `packages/connectors/src/<name>/capture.ts` - before-image read plus
   snapshot `put`. Mirror `captureBeforeImage`
   (packages/connectors/src/postgres/capture.ts:34) or `captureObject`
   (packages/connectors/src/s3/capture.ts:34). Define your own client or
   executor type here, the way `QueryExecutor`
   (packages/connectors/src/postgres/capture.ts:4) and `S3Client`
   (packages/connectors/src/s3/classify.ts:26) do.
3. `packages/connectors/src/<name>/inverse.ts` - plan builder plus drift
   report. Mirror `buildInverse`
   (packages/connectors/src/postgres/inverse.ts:23) plus
   `buildDriftReport` (packages/connectors/src/postgres/inverse.ts:36), or
   `restoreObject` (packages/connectors/src/s3/inverse.ts:14) for a
   byte-restore shape.
4. `packages/connectors/src/<name>/apply.ts` (or `replay.ts` if you need a
   transaction like postgres) - guarded apply. Mirror `applyInverse`
   (packages/connectors/src/postgres/replay.ts:16) or `applyRestore`
   (packages/connectors/src/s3/apply.ts:31). It must refuse on drift and
   never write when the current state moved.
5. `packages/connectors/src/<name>/<name>.test.ts` - `node:test` suite for
   the four behaviors in section 5 below. Mirror
   `packages/connectors/src/postgres/capture.test.ts`,
   `packages/connectors/src/postgres/classify.test.ts`,
   `packages/connectors/src/postgres/inverse.test.ts`, or
   `packages/connectors/src/s3/s3.test.ts`.

Do not create any other production file in step 1. Wiring lives in one
place only: `packages/connectors/src/registry.ts` (section 4).

## 2. The exact Connector interface to implement

The interface is `Connector` in packages/connectors/src/registry.ts:78.
It has 7 members. Implement all 7; none is optional.

- `id: ConnectorId` in packages/connectors/src/registry.ts:79. The id
  union is `ConnectorId` in packages/connectors/src/registry.ts:12, today
  `"postgres" | "s3"`. After your change it must include your new literal
  (section 4).
- `surface: string` in packages/connectors/src/registry.ts:80. Postgres
  uses `"postgres"` and s3 uses `"s3"`. Use your vendor prefix.
- `probes: readonly Probe[]` in packages/connectors/src/registry.ts:81.
  Return `pickProbes("<name>")`
  (packages/connectors/src/probes/registry.ts:25) after you add your probe
  pair next to the postgres and s3 pairs, or return `[]` only if you also
  add a `pickProbes` branch that documents why this connector has no
  probes. Do not borrow another connector's probes.
- `classify: (call: ConnectorCall) => Promise<ClassifiedCallFacts>` in
  packages/connectors/src/registry.ts:82. Input is `ConnectorCall` in
  packages/connectors/src/registry.ts:21 (`tool`, `connector`,
  `arguments`, `workspace`). Output is `ClassifiedCallFacts` in
  packages/connectors/src/registry.ts:28 (`call`, `facts`,
  `blastRadius`, `notes`). Keep `blastRadius` as `undefined` unless you
  have a measured row or byte count; both existing connectors do that.
- `capture: (call: ConnectorCall) => Promise<CaptureResult>` in
  packages/connectors/src/registry.ts:83. Output is `CaptureResult` in
  packages/connectors/src/registry.ts:35 (`reference`, `digest`, `facts`,
  `capturedAt`). The `digest` must equal `reference.digest`; the registry
  test asserts this for postgres and you must hold the same invariant.
- `inverse: (capture: SnapshotReference) => Promise<InversePlan>` in
  packages/connectors/src/registry.ts:84. Output is `InversePlan` in
  packages/connectors/src/registry.ts:50 (`connector`, `call`, `capture`,
  `steps`, `facts`) where each step is an `InverseStep` in
  packages/connectors/src/registry.ts:42 (`id`, `target`, `operation`,
  `dependsOn`, `inputDigest`).
- `apply: (plan: InversePlan) => Promise<ApplyReport>` in
  packages/connectors/src/registry.ts:85. Output is `ApplyReport` in
  packages/connectors/src/registry.ts:73 (`applied`, `refused`) where each
  refusal is a `ReplayRefusal` in
  packages/connectors/src/registry.ts:66 with reason `"drift"` or
  `"missing_target"` or `"permission_denied"` or `"internal_error"`,
  plus the `DriftChange` detail shape in
  packages/connectors/src/registry.ts:58 when drift is the reason.

Supporting types you will touch:

- `ConnectorRegistry` in packages/connectors/src/registry.ts:88 is
  `Readonly<Record<ConnectorId, Connector>>`; adding a `ConnectorId`
  literal forces a new key on the registry object.
- `ConnectorDeps` in packages/connectors/src/registry.ts:90 is
  `{ store, exec?, s3? }`. Add one optional field for your client, for
  example `myClient?: MyClient`, following the `exec?` and `s3?` pattern.
  Wire it with the same fail-closed `requireDependency` helper the
  postgres and s3 makers use.

## 3. How classify, capture, inverse, and replay plug together

Implement this exact order. Each stage feeds the next; do not skip one.

Step 1, classify (no writes). Parse or probe, then return facts plus
notes. Postgres `classify` parses with `parseStatement`
(packages/connectors/src/postgres/parse.ts:33) and emits the two derived
facts with notes for `other` statements. S3 `classify` calls `s3Facts`
(packages/connectors/src/s3/classify.ts:66) with the narrowed call and
maps probe errors into `notes`. Your classify must be side-effect free:
no snapshot writes, no target writes.

Step 2, capture (read then store, no target writes). Read the before-image
first, then `store.put` it under a workspace namespace. Postgres capture
reads rows with `captureBeforeImage`
(packages/connectors/src/postgres/capture.ts:34), encodes the image as
JSON, stores it, derives facts with `connectorFacts`
(packages/connectors/src/postgres/classify.ts:5), prebuilds steps with
`buildInverse` (packages/connectors/src/postgres/inverse.ts:23), and
caches `{ call, image, steps }` in a per-registry map keyed by digest and
URI. S3 capture reads bytes with `captureObject`
(packages/connectors/src/s3/capture.ts:34), stores the raw bytes, and
caches `{ call, input, facts }` where `input` is an `ApplyRestoreInput`
(packages/connectors/src/s3/apply.ts:24) holding `stepId`, `call`,
`reference`, and `capturedEtag`. Mirror one of these two cache shapes so
`inverse` can run without re-reading the target.

Step 3, inverse (pure plan from a `SnapshotReference`, no I/O against the
target except an optional snapshot `get`). Look up the cached capture by
reference; if it is absent, either rehydrate from the snapshot store the
way postgres does or throw the way s3 does (s3 throws `"missing captured
S3 call for snapshot reference"` when the map has no entry). Map stored
steps to `InverseStep` (packages/connectors/src/registry.ts:42): postgres
maps each `InverseStep` from `inverse.ts` (table, operation, dependsOn,
inputDigest) to a plan step with `target` set to the table; s3 builds one
step with `target` set to `s3://bucket/key`, `operation` set to
`"putObject"`, empty `dependsOn`, and `inputDigest` set to
`reference.digest`. Keep the stored capture alongside the plan (the
`postgres` or `s3` extra field on the plan object) so `apply` can use it
without a second lookup.

Step 4, apply or replay (drift check first, then write, with refusal on
any mismatch). Postgres `apply` resolves the stored plan, runs
`applyInverse` (packages/connectors/src/postgres/replay.ts:16), and maps
the `ApplyInverseReport` (packages/connectors/src/postgres/replay.ts:11)
into an `ApplyReport` (packages/connectors/src/registry.ts:73); driver
exceptions become `{ stepId: "transaction", reason: "internal_error" }`.
S3 `apply` runs `applyRestore`
(packages/connectors/src/s3/apply.ts:31), which returns drift with the
etag detail when the live object moved, restores with `restoreObject`
(packages/connectors/src/s3/inverse.ts:14) when it did not, and restores
cleanly when the target is absent. Your apply must follow the same rule:
check current state against the captured digest or version first; on any
mismatch return `refused` with reason `"drift"` and leave the target
untouched.

## 4. Registering the ConnectorId

Three edits, all in `packages/connectors/src/registry.ts`. Nothing else
registers a connector.

1. Extend the union `ConnectorId` in
   packages/connectors/src/registry.ts:12 from
   `"postgres" | "s3"` to `"postgres" | "s3" | "<name>"`.
2. Add your maker next to `makePostgresConnector` and `makeS3Connector`,
   then add the new key inside `makeConnector` in
   packages/connectors/src/registry.ts:120 so the returned object has all
   three keys. `connectorRegistry` in
   packages/connectors/src/registry.ts:116 delegates to `makeConnector`,
   so it picks up the new connector automatically. Extend `ConnectorDeps`
   in packages/connectors/src/registry.ts:90 with your optional client.
3. Extend the vendor branch in `connectorFor` in
   packages/connectors/src/registry.ts:130, which today accepts only
   `"postgres"` and `"s3"` and returns `null` otherwise. Add your vendor
   string to the check and to the registry index. Unknown vendors must
   keep returning `null` so callers deny instead of guessing.

Also add a `pickProbes` branch in
packages/connectors/src/probes/registry.ts:25 for your connector id,
following the postgres pair and the s3 pair. If your connector needs no
probes, return `[]` from that branch explicitly.

## 5. Tests to add (node:test only)

Use `node:test` with `node:assert/strict` and local fake clients. No test
dependencies, no flags. Mirror these files:

- Registry wiring: `packages/connectors/src/registry.test.ts`.
  - Vendor mapping pattern: `connectorFor maps vendor prefixes and returns
    null for unknown vendors` in
    packages/connectors/src/registry.test.ts:12 asserts
    `connectorFor("postgres.orders_delete")` maps to postgres,
    `connectorFor("s3.object_delete")` maps to s3, and unknown vendors map
    to `null`. Add your vendor (for example
    `connectorFor("<name>.thing_delete")`) plus one more unknown-vendor
    `null` case.
  - Surface pattern: `registry binds connector functions and probe sets`
    in packages/connectors/src/registry.test.ts:24 asserts the registry
    keys and that each connector exposes `classify`, `capture`,
    `inverse`, and `apply` as functions with a non-empty `probes` array.
    Extend the key list to `["<name>", "postgres", "s3"]` and assert the
    same four functions for your connector.
  - Round-trip pattern: `makeConnector wires Postgres capture and inverse
    with fake dependencies` in
    packages/connectors/src/registry.test.ts:40 builds a
    `MemorySnapshotStore`
    (packages/connectors/src/registry.test.ts:87) plus a
    `FakeQueryExecutor` (packages/connectors/src/registry.test.ts:109),
    captures an update, runs inverse, and asserts digest equality, plan
    connector and target, and the `pg.capture.before_image` fact. The s3
    twin is `makeConnector wires S3 capture and inverse with fake
    dependencies` in packages/connectors/src/registry.test.ts:65 with a
    `FakeS3Client` (packages/connectors/src/registry.test.ts:125). Add one
    `makeConnector wires <name> capture and inverse` test with your fake
    client in the same style.
- Classify: mirror `emits postgres registry facts as strings` in
  packages/connectors/src/postgres/classify.test.ts:10 for a pure mapping,
  or the three `s3Facts` tests in packages/connectors/src/s3/s3.test.ts:58
  (`maps versioning, object existence, and versionId facts`), in
  packages/connectors/src/s3/s3.test.ts:73 (`maps missing keys and
  disabled versioning`), and in
  packages/connectors/src/s3/s3.test.ts:83 (`omits unknown facts when a
  probe fails`). At minimum cover: facts present on success, absent fact
  on probe failure, never an invented `unknown` value.
- Capture: mirror `captures update rows with the parsed predicate` in
  packages/connectors/src/postgres/capture.test.ts:25, `captures delete
  rows and traverses cascade tables` in
  packages/connectors/src/postgres/capture.test.ts:35, and `lists cascade
  tables from information schema` in
  packages/connectors/src/postgres/capture.test.ts:51; or `captures bytes
  through a snapshot store` in packages/connectors/src/s3/s3.test.ts:103.
  Assert the snapshot bytes round-trip through the store and the digest
  equality (`sha256` in packages/connectors/src/s3/capture.ts:71, or
  `sha256Digest` in packages/connectors/src/snapshot/store.ts:30).
- Inverse plus drift refusal: mirror `builds update steps and restores
  changed rows` in packages/connectors/src/postgres/inverse.test.ts:54,
  `builds inserts in reverse dependency order` in
  packages/connectors/src/postgres/inverse.test.ts:65, `replay refuses
  when drift changed a captured field` in
  packages/connectors/src/postgres/inverse.test.ts:76, and `drift report
  names missing rows` in
  packages/connectors/src/postgres/inverse.test.ts:86; or the s3 trio
  `restores captured bytes` in packages/connectors/src/s3/s3.test.ts:116,
  `refuses to restore when etag drift is detected` in
  packages/connectors/src/s3/s3.test.ts:125, and `restores when current
  target is absent` in packages/connectors/src/s3/s3.test.ts:140. Your
  suite must contain both a round-trip restore test and a drift refusal
  test that leaves the human-changed state untouched.

Run each new suite with the same command shape used for the registry:

```sh
node --test packages/connectors/src/<name>/<name>.test.ts
node --test packages/connectors/src/registry.test.ts
```

## 6. Proving it with e2e-connectors.mjs

The e2e script is `scripts/src/e2e-connectors.mjs`. It runs five checks
through `runAllChecks` in scripts/src/e2e-connectors.mjs:52 using the
`check` helper in scripts/src/e2e-connectors.mjs:43, with per-connector
moments you mirror:

- `runPostgresRoundTrip` in scripts/src/e2e-connectors.mjs:71 does
  capture with `captureBeforeImage`
  (packages/connectors/src/postgres/capture.ts:34), facts with
  `connectorFacts` (packages/connectors/src/postgres/classify.ts:5),
  snapshot put, manifest write with `manifestWriter`
  (packages/connectors/src/manifest.ts:19), target mutation, inverse with
  `buildInverse` (packages/connectors/src/postgres/inverse.ts:23), apply
  with `applyInverse` (packages/connectors/src/postgres/replay.ts:16),
  and asserts facts, empty `refused`, restored rows, and the tool string
  in `manifest.jsonl`.
- `runPostgresDrift` in scripts/src/e2e-connectors.mjs:97 captures, lets
  a human change the row, applies, and asserts empty `applied`, reason
  `drift`, the column detail in the report, and untouched human state.
- `runReplayDryRun` in scripts/src/e2e-connectors.mjs:111 writes a ledger
  entry plus a manifest entry, then runs the replay command dry-run path
  and asserts the tool, digest, snapshot URI, and step lines appear.
- `runS3RoundTrip` in scripts/src/e2e-connectors.mjs:165 captures with
  `captureObject` (packages/connectors/src/s3/capture.ts:34), deletes,
  restores direct with `restoreObject`
  (packages/connectors/src/s3/inverse.ts:14), then restores through
  `applyRestore` (packages/connectors/src/s3/apply.ts:31) and asserts
  bytes plus `{ applied: ["restore-s3"], refused: [] }`.
- `runS3Drift` in scripts/src/e2e-connectors.mjs:185 captures, writes a
  human change, applies, and asserts empty `applied`, reason `drift`, and
  untouched human bytes.

To prove your connector, add one `run<Name>RoundTrip` function and one
`run<Name>Drift` function in the same file, register both inside
`runAllChecks` (scripts/src/e2e-connectors.mjs:52), and run the script
with `node scripts/src/e2e-connectors.mjs`. A passing run prints one
`PASS <name>` line per check and exits 0; any failure prints `FAIL
<name>` with a stack and exits 1. Do not change the existing five checks.

## 7. Checklist

Map each item to the existing postgres and s3 proof it mirrors. Check
every box before asking for review.

- [ ] Interface implemented: all 7 `Connector` members
      (packages/connectors/src/registry.ts:78: `id` at
      packages/connectors/src/registry.ts:79, `surface` at
      packages/connectors/src/registry.ts:80, `probes` at
      packages/connectors/src/registry.ts:81, `classify` at
      packages/connectors/src/registry.ts:82, `capture` at
      packages/connectors/src/registry.ts:83, `inverse` at
      packages/connectors/src/registry.ts:84, `apply` at
      packages/connectors/src/registry.ts:85). Proven by the registry
      surface test in packages/connectors/src/registry.test.ts:24.
- [ ] Classify tests: facts on success, absent fact on probe failure, no
      invented `unknown`. Mirrors
      packages/connectors/src/postgres/classify.test.ts:10 and
      packages/connectors/src/s3/s3.test.ts:58 plus
      packages/connectors/src/s3/s3.test.ts:73 plus
      packages/connectors/src/s3/s3.test.ts:83.
- [ ] Capture round trip: before-image bytes survive a snapshot store
      put and get with matching digest. Mirrors
      packages/connectors/src/postgres/capture.test.ts:25 plus
      packages/connectors/src/postgres/capture.test.ts:35 plus
      packages/connectors/src/postgres/capture.test.ts:51 and
      packages/connectors/src/s3/s3.test.ts:103, plus the registry
      round trips in packages/connectors/src/registry.test.ts:40 and
      packages/connectors/src/registry.test.ts:65.
- [ ] Inverse plan: steps carry `id`, `target`, `operation`,
      `dependsOn`, and `inputDigest`
      (packages/connectors/src/registry.ts:42) in dependency order.
      Mirrors packages/connectors/src/postgres/inverse.test.ts:54 plus
      packages/connectors/src/postgres/inverse.test.ts:65 and the s3
      restore in packages/connectors/src/s3/s3.test.ts:116.
- [ ] Drift refusal: concurrent human change yields empty `applied`,
      reason `drift`, and untouched target. Mirrors
      packages/connectors/src/postgres/inverse.test.ts:76 plus
      packages/connectors/src/postgres/inverse.test.ts:86 and
      packages/connectors/src/s3/s3.test.ts:125, plus the absent-target
      restore in packages/connectors/src/s3/s3.test.ts:140.
- [ ] Registry entry: `ConnectorId`
      (packages/connectors/src/registry.ts:12) extended, `makeConnector`
      (packages/connectors/src/registry.ts:120) returns the new key,
      `connectorFor` (packages/connectors/src/registry.ts:130) maps the
      new vendor and still returns `null` for unknown vendors, `probes`
      wired through `pickProbes`
      (packages/connectors/src/probes/registry.ts:25). Proven by
      packages/connectors/src/registry.test.ts:12 and
      packages/connectors/src/registry.test.ts:24.
- [ ] E2e moment: new `run<Name>RoundTrip` plus `run<Name>Drift`
      registered in `runAllChecks`
      (scripts/src/e2e-connectors.mjs:52) next to
      scripts/src/e2e-connectors.mjs:71,
      scripts/src/e2e-connectors.mjs:97,
      scripts/src/e2e-connectors.mjs:165, and
      scripts/src/e2e-connectors.mjs:185, with the manifest write path
      (`manifestWriter` in packages/connectors/src/manifest.ts:19)
      covered the way the postgres round trip covers it. The replay
      dry-run shape in scripts/src/e2e-connectors.mjs:111 stays
      unchanged.
