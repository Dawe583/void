# @void/connectors contract

This README freezes the connector contract for WP-06 and WP-07. It is the
contract every concrete connector implements. The first implementations are
Postgres and S3.

Connectors are the fact source for classification, capture, inverse planning,
and replay. The proxy owns interception and policy. The registry owns ordered
cases and preconditions. A connector never imports another connector. The proxy
resolves connectors by id from a list it is handed.

## Design goals

1. Classify a call from target state that only the connector can know.
2. Capture enough before image data to build a true inverse for R0 and R1.
3. Return loud typed failures when capture or inverse is not possible.
4. Keep customer bytes in customer controlled storage.
5. Detect replay drift and refuse instead of overwriting later human work.
6. Feed facts into the registry evaluator without teaching the proxy target
   semantics.

## Connector interface

The interface is structural TypeScript. It is async from the first version
because real connectors call databases, object stores, and snapshot stores.

```ts
export type ConnectorId = string;
export type RegistryEntryId = string;
export type ReversibilityClass = "r0" | "r1" | "r2" | "r3";
export type FactValue = string | boolean;
export type ConnectorFact = { readonly name: string; readonly value: FactValue; readonly source: "declared" | "captured" | "probed" | "derived"; readonly verifiedAt: string };
export type ConnectorCall = { readonly tool: RegistryEntryId; readonly connector: ConnectorId; readonly arguments: Readonly<Record<string, unknown>>; readonly workspace: string | undefined };
export type ClassifiedCallFacts = { readonly call: ConnectorCall; readonly facts: readonly ConnectorFact[]; readonly blastRadius: number | undefined; readonly notes: readonly string[] };
export type SnapshotReference = { readonly namespace: string; readonly digest: `sha256:${string}`; readonly uri: string };
export type CaptureResult = { readonly reference: SnapshotReference; readonly digest: `sha256:${string}`; readonly facts: readonly ConnectorFact[]; readonly capturedAt: string };
export type InverseStep = { readonly id: string; readonly target: string; readonly operation: string; readonly dependsOn: readonly string[]; readonly inputDigest: `sha256:${string}` };
export type InversePlan = { readonly connector: ConnectorId; readonly call: ConnectorCall; readonly capture: SnapshotReference; readonly steps: readonly InverseStep[]; readonly facts: readonly ConnectorFact[] };
export type DriftChange = { readonly target: string; readonly key: Readonly<Record<string, string>>; readonly field: string; readonly capturedDigest: `sha256:${string}`; readonly currentDigest: `sha256:${string}` };
export type ReplayRefusal = { readonly stepId: string; readonly reason: "drift" | "missing_target" | "permission_denied" | "internal_error"; readonly changed: readonly DriftChange[] };
export type ApplyReport = { readonly applied: readonly string[]; readonly refused: readonly ReplayRefusal[] };
export type Connector = { readonly id: ConnectorId; readonly surface: string; readonly classify: (call: ConnectorCall) => Promise<ClassifiedCallFacts>; readonly capture: (call: ConnectorCall) => Promise<CaptureResult>; readonly inverse: (capture: SnapshotReference) => Promise<InversePlan>; readonly apply: (plan: InversePlan) => Promise<ApplyReport> };
```

## Typed errors

A connector never returns `null` or `undefined` for a failed safety operation.
Every failure is loud and typed. The proxy converts the error to a deny or hold
path according to policy, but the connector reports the reason precisely.

```ts
export type ConnectorErrorKind =
  | "CaptureFailed"
  | "InverseImpossible"
  | "SnapshotUnavailable"
  | "ParseFailed"
  | "ReplayRefused";

export type ConnectorError = Error & {
  readonly kind: ConnectorErrorKind;
  readonly connector: ConnectorId;
  readonly call: RegistryEntryId | undefined;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
};
```

`CaptureFailed` means the before image could not be persisted before the write.
The upstream write must not run after this failure. `InverseImpossible` means
the connector cannot construct a true inverse from the captured image.
`SnapshotUnavailable` means the reference cannot be read or its digest does not
match. `ParseFailed` means the connector cannot safely understand the call.
`ReplayRefused` means apply detected drift or another fail-closed condition.

## SnapshotStore interface

The snapshot store stores bytes and returns references. It does not classify
calls and it does not know connector semantics. Redaction runs before bytes
leave the process, including for a local directory store.

```ts
export type SnapshotNamespace = string;
export type SnapshotPutResult = { readonly digest: `sha256:${string}`; readonly reference: SnapshotReference };
export type RetentionReport = { readonly deleted: number; readonly freedBytes: number; readonly errors: readonly string[] };
export type RetentionPlan = { readonly namespace: SnapshotNamespace; readonly retainedBytes: number; readonly deleteOlderThan: (cutoff: Date) => Promise<RetentionReport> };
export type RedactionHook = (input: { readonly namespace: SnapshotNamespace; readonly bytes: Uint8Array; readonly metadata: Readonly<Record<string, string>> }) => Promise<Uint8Array>;
export type SnapshotStore = { readonly put: (namespace: SnapshotNamespace, bytes: Uint8Array, metadata?: Readonly<Record<string, string>>) => Promise<SnapshotPutResult>; readonly get: (reference: SnapshotReference) => Promise<Uint8Array>; readonly retention: (namespace: SnapshotNamespace) => Promise<RetentionPlan> };
```

Two implementations are planned later: `snapshot/local.ts` and
`snapshot/s3.ts`. Both compute `sha256:` over the redacted bytes they store,
verify the digest on `get`, expose retained byte count, and expose a
delete-by-age hook. Neither logs payload bytes.

The ledger stores digests and references, never payload bytes. The snapshot
store is where before images live. Redaction is before storage, not a read-time
display filter, because secrets must not leave the process in the first place.

## Postgres connector module map

The Postgres connector is split by pipeline phase. Each module takes its
dependencies as parameters. No module reads a process global connection or a
process global parser.

### `postgres/parse.ts`

`parse.ts` converts SQL into statement type, target tables, predicate, and
`RETURNING`. It starts with `UPDATE` and `DELETE`. It must use a real SQL
parser. The selected parser is `node-sql-parser`, but it is not installed yet.
The interface therefore accepts a parse function as an injected dependency.

```ts
export type ParseSql = (sql: string) => Promise<unknown>;
export type ParsePostgres = (sql: string, deps: { readonly parseSql: ParseSql }) => Promise<ParsedPostgresWrite>;
```

Regex parsing is rejected. It cannot safely handle subqueries, quoted names,
CTEs, casts, or comments. If the parser cannot produce the narrow shape, the
connector returns `ParseFailed` and the call is denied.

### `postgres/capture.ts`

`capture.ts` reads the before image before the upstream write runs. For
`UPDATE`, it performs keyed `SELECT` for every matched row. For `DELETE`, it
captures full rows and walks `information_schema` for `ON DELETE CASCADE`.

```ts
export type PostgresQuery = <Row>(sql: string, parameters: readonly unknown[]) => Promise<readonly Row[]>;
export type CapturePostgres = (write: ParsedPostgresWrite, deps: PostgresCaptureDeps) => Promise<CaptureResult>;
```

The capture facts include `pg.capture.before_image=true` only when every matched
row and every traversed cascade row was captured and stored. They include
`pg.cascade.traversed=true` when at least one cascade edge was traversed.

### `postgres/inverse.ts`

`inverse.ts` builds an ordered inverse plan from the captured image. For
`UPDATE`, each step is a keyed `UPDATE` that restores captured values. For
`DELETE`, each step is an `INSERT` that preserves identity columns and foreign
keys.

```ts
export type BuildPostgresInverse = (
  capture: SnapshotReference,
  deps: { readonly snapshotStore: SnapshotStore },
) => Promise<InversePlan>;
```

`DELETE` inverse steps are ordered so parents exist before children when rows
are inserted. If the capture lacks required key or identity data, `inverse.ts`
throws `InverseImpossible`.

### `postgres/replay.ts`

`replay.ts` applies the inverse in dependency order inside one transaction.
Before each step, it verifies drift. If any target row changed since capture,
replay refuses and reports the changed fields. It never overwrites the current
row with the older image.

```ts
export type ReplayPostgresDeps = {
  readonly transaction: <T>(run: (query: PostgresQuery) => Promise<T>) => Promise<T>;
  readonly clock: () => Date;
};

export type ReplayPostgres = (
  plan: InversePlan,
  deps: ReplayPostgresDeps,
) => Promise<ApplyReport>;
```

Drift comparison is digest based by field. The report names the table, primary
key, field, captured digest, and current digest. A human can then choose a
manual repair path. VOID does not choose it.

## S3 connector module map

### `s3/classify.ts`

Classification reads versioning state and key state from declared facts or from
a later probe. Required facts are `bucket.versioning`, `bucket.mfa_delete`, and
`s3.key.existed`. With versioning `Enabled` and MFA delete `off`, a key delete
without `versionId` is R0 because the delete writes a marker. With an explicit
`versionId`, it is R3 because a concrete version is destroyed. With versioning
`Disabled` or `Suspended`, delete is R3 unless a separate snapshot capture makes
a different future case possible.

### `s3/capture.ts`

For delete, capture copies object bytes to the snapshot store before the
upstream delete. It also records the current version id when versioning is on.
For put over an existing key, capture records the prior version id when
available and records the prior bytes when required by policy. If the snapshot
write fails, the connector throws `CaptureFailed` and the proxy must not forward
the write.

### `s3/inverse.ts`

For a versioned delete, inverse removes the delete marker or restores the prior
version as current. For an overwrite, inverse restores the prior version or
copies captured bytes back to the key. For an unversioned delete with no
captured bytes, inverse throws `InverseImpossible`.

### `s3/apply.ts`

Apply executes the inverse plan and verifies the restored object's digest or
ETag when available. If the key changed after capture, replay refuses with a
drift report rather than replacing the newer object.

## Drift rule

The trap in WP-06 is explicit: a row changed by a human between capture and
replay makes replay refuse. This rule applies to all connectors.

- Capture records enough per-target digests to compare later state.
- Replay checks the current target before applying a step.
- Any changed field or object digest causes a refusal.
- The refusal report names what changed.
- Replay never overwrites newer human work with an older captured image.

For Postgres, drift is field level for each primary key. For S3, drift is object
level by version id, ETag, or content digest. Missing targets are refusals unless
the inverse step explicitly expects absence.

## Facts reported to the registry evaluator

The connector is the fact source. The proxy merges connector facts with declared
operator facts and call arguments, then asks the registry evaluator to pick the
first matching case. The proxy does not derive target facts itself.

Fact names must match `packages/registry/docs/facts.md`.

| Fact | Source | Meaning |
| ---- | ------ | ------- |
| `pg.capture.before_image` | Postgres capture | Every matched row before image was captured. |
| `pg.transaction.void_controlled` | Postgres execution | The statement runs inside a transaction VOID controls. |
| `pg.cascade.traversed` | Postgres capture | An `ON DELETE CASCADE` edge was traversed. |
| `bucket.versioning` | S3 classify | Bucket versioning state. |
| `bucket.mfa_delete` | S3 classify | Bucket MFA delete state. |
| `s3.key.existed` | S3 classify or capture | The object key existed before the call. |
| `s3.policy.widens_access` | S3 classify | A new bucket policy widens access beyond the account. |

The fact array in `classify` may include declared and probed facts. The fact
array in `capture` includes facts proven by the captured before image. When
facts disagree, the proxy reports the conflict and fails closed unless a later
policy explicitly chooses a precedence rule.

## Policy and ledger handoff

The proxy projects the classified result into the policy call shape.

```ts
export type ConnectorPolicyProjection = {
  readonly tool: RegistryEntryId;
  readonly connector: ConnectorId;
  readonly workspace: string | undefined;
  readonly klass: ReversibilityClass;
  readonly blastRadius: number | undefined;
};
```

The ledger entry stores the selected class, policy decision, snapshot reference,
and digests. It does not store snapshot bytes or unredacted call payloads.

## Decision rationale

`classify` returns facts rather than a class because the registry remains the
only authority for ordered cases. This keeps connector code from duplicating
policy.

`capture` is separate from `classify` because classification can happen before a
policy decision, while capture must happen immediately before an allowed write.

`inverse` consumes a snapshot reference rather than process memory because
replay can happen in a later process. The snapshot digest binds that process to
the exact bytes captured before the write.

`apply` returns a report rather than throwing for ordinary drift because drift is
an expected safety outcome. It throws only for internal failures that prevent an
honest report.

`SnapshotStore` owns redaction so every connector gets the same boundary: bytes
are redacted before they leave the process. A connector may add connector
specific redaction first, but it may not bypass the store hook.

`node-sql-parser` is injectable because the dependency is not installed yet and
because parser behavior must be testable without module substitution. Adding the
dependency later requires written supply chain justification.
