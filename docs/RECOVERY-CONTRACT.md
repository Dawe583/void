# Executable recovery contract

VOID can restore only the scope captured and verified by the selected executable
adapter. A registry entry, OAuth connection, snapshot or generated inverse name
alone is not proof of recoverability.

Three independent observations describe each call:

| Axis | Values | Meaning |
| --- | --- | --- |
| Effect | read, write, external-disclosure, mixed, unknown | Observable action |
| Reversibility | r0, r1, r2, r3, unknown | Exact restore, restore with trace, compensation, no inverse, or unproven |
| Readiness | verified, conditional, expired, unsupported, unknown-outcome, conflict | Current availability of that recovery |

R0 is not a synonym for GET. A read can disclose information irreversibly. R1
restores declared state but does not erase logs, observations or transaction
history. Every adapter supplies a scope and a resource set. Unknown blast radius
cannot pass an exact count limit.

## Managed execution

`RecoveryAdapter` in `packages/connectors/src/recovery.ts` is the executable
contract. The root `ConnectorDescriptor` is metadata; the older `registry.ts`
Connector retains compatibility for legacy capture/apply integrations. Neither
is implicitly promoted to a managed adapter.

The runtime records received, authorized, prepared, dispatched and outcome in a
signed journal. Arguments and before images go into authenticated encrypted
artifacts. Durable capture precedes dispatch. The adapter must revalidate
observations and provide atomicity or compare-and-swap at the actual write.

Workspace and operation ID identify one immutable request. Reusing the ID with
another request or adapter version is refused. An interrupted dispatch is
unknown, never automatically repeated. Reconciliation reads durable evidence.
An absent receipt is not proof that nothing happened.

Recovery requires the exact plan digest and separate operator authorization.
A changed plan is refused. Human drift is a conflict. Recovery writes a new
signed event linked by `reverses`; it never deletes original evidence. Unknown
recovery results can be reconciled when the adapter supports durable receipts.
Reconciliation never repeats the inverse.

## Trust boundary

Current local mode is cooperative. It does not intercept arbitrary shell,
network, browser or third-party tool actions outside the managed executor.
The operator controls credentials, configured tables, policy and local keys.
An agent may not supply its own workspace, adapter identity or approval grant
to the managed MCP server. The local policy is reloaded for each request.

The local journal serializes a directory using a SQLite transaction as an OS-backed
writer mutex. Signed JSONL remains the operation source of truth. Process death
releases the mutex; a SIGKILL regression verifies that the next executor reads
`dispatched` as unknown without repeating the write. This requires a local disk,
not NFS or a distributed filesystem. Never delete the SQLite file while writers
may exist. A legacy `.runtime.lock` blocks startup until the old executor has
been stopped and the operator has reviewed migration.

The CLI uses `reservedRecoveryVault`: encrypted payloads and reservation changes
commit in one local SQLite transaction. Before preparation the runtime reserves
three bounded slots for capture, outcome and recovery evidence. Default limits
are 64 MiB per plaintext artifact and 1 GiB total encrypted payload plus unused
reservations. Successful writes replace their reservation with actual byte use.
Confirmed failures release unused slots; unknown results retain them. Stored
artifacts are never implicitly deleted.

This is a logical payload quota, not physical disk preallocation. SQLite pages,
journals and filesystem overhead require extra free space. Real disk exhaustion
still fails closed before dispatch, or leaves an uncertain result after dispatch.
Streaming, automatic GC, retention and administrative quota migration remain
unfinished. Capacity settings persist and mismatching workers are rejected.

The older `localRecoveryVault` remains compatible but offers only an individual
artifact limit. `reservedRecoveryVault` reads its existing files and counts them
against the shared quota. Stop old writers before migration; mixed writer
versions are not supported. Back up signing keys, encryption keys, operation
journal, vault SQLite database and legacy artifacts together. Use a stopped
executor or SQLite-aware backup. Signature verification establishes integrity,
not completeness of an unanchored truncated history.

See `RECOVERY-COVERAGE.md` for the supported subset and evidence.

## Irreversibility budget

Managed runtime defaults to requiring verified R0/R1 recovery. A host that
explicitly disables that requirement must configure `irreversibilityBudget`
before R3, unknown or currently unverified recovery operations can execute. The local implementation reserves
one unit per operation in the same signed workspace transaction as authorization.
`dailyLimit` caps a UTC authorization day; optional `perAgentDailyLimit` narrows
it further. Unknown and unfinished operations retain their units. Only a
confirmed failed operation releases a reservation. Host time defines the day;
this is not a distributed-clock accounting service.

The budget does not grant permission: the host authorization callback must
still allow the call. It does not make R3 reversible; a successful R3 operation
cannot produce a verified recovery plan. Cloud/distributed budgets, mode
rollout, weighted costs and staged reservations remain future work.

## Local managed documents

Local Workbench uses the shared runtime for model and operator document writes,
deletes, branch copies and Undo. Its host lock serializes edits; its existing
encrypted workspace snapshot atomically stores document transitions and signed
legacy evidence. The new runtime journal and encrypted artifacts add lifecycle
and capacity protection. Read tools remain on the existing lightweight path.

New signed document entries identify the managed runtime operation. Missing
runtime evidence refuses recovery; it cannot masquerade as an old operation.
Unmarked historical operations still require their original signature/capture
verification. The cloud host is a separate pending integration.
