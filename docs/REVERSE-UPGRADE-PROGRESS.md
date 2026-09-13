# Reverse upgrade implementation progress

This tracks REVERSE-TOOL-UPGRADE-PLAN.md. No full milestone is declared complete
by the existence of a prototype or a narrow passing test.

| Package | Current implementation | Remaining release gates |
| --- | --- | --- |
| R00 | Contract, coverage, context corrections, descriptor vs executable adapter distinction | Machine-readable provider certification and public-site alignment |
| R01 | Signed local journal, immutable operation identity, unknown results, adapter reconciliation | Cloud transactional journal, full persistence fault matrix |
| R02 | Shared runtime used by managed CLI/MCP, TS SDK and local workbench document writes/Undo | Legacy proxy and general external-tool cloud conformance |
| R03 | Encrypted durable artifacts, reserved capture/outcome/recovery capacity, shared quota, legacy reads, key rotation | Streaming, pin lifecycle, GC, retention, quota migration |
| R04 | Structured row mutations, revision trigger, atomic outbox, verified restore, real prepare serialization conflict, managed deadlock and terminated database sessions | Cascade/tenant certification, migration, client process kill and network partition |
| R05 | Partial | Cooperative one-file create/write/delete and guarded Undo; Git and rename pending |
| R06 | Single-operation plan, exact digest, signed recovery, uncertain recovery reconciliation | Multi-operation jobs, selection boundaries, dependencies, durable leases/checkpoints |
| R07 | Existing taint modules retained | Runtime provenance and dependency-aware recovery integration |
| R08 | Existing legacy S3 retained | Managed S3/versioning, Supabase-specific capability tests |
| R09 | Existing OAuth layer retained | GitHub/Vercel executable recovery adapters and real sandbox conformance |
| R10 | Local daily workspace/per-agent reservations; concurrent/restart test | Cloud accounting, modes, approvals integration and full reservation fault matrix |
| R11 | Not started | Staged graph, cancellation, barriers and restart semantics |
| R12 | Executable adapter interface and managed TS SDK | Conformance command, Python transport client, versioned capability manifests |
| R13 | Local MCP entry point with operator identity/policy | OpenCode doctor/init, authenticated remote executor, managed egress boundary |
| R14 | Coverage, runbook, scoped validation evidence | Export bundles/checkpoint completeness, metrics, operational certification |

## Verified foundation

- Actual managed PostgreSQL mutation and transactionally bound before/outcome evidence.
- Encrypted capture before dispatch and signed local lifecycle.
- Human drift and ABA conflict refusal, including substituted trigger and table identity.
- Restarted runtime recovery, idempotent repeated calls and lost-response reconciliation.
- MCP client integration and an actual stdio subprocess startup/deny test.
- SDK capture-failure refusal and recovery using the same runtime.
- Concurrent local irreversibility accounting with unknown outcomes retained.

## Next implementation sequence

1. Complete the remaining client-process crash and persistence fault cases before
   promoting M1 from verified subset to release milestone. Real database-session
   termination and a managed-dispatch deadlock now have executable coverage.
2. Cloud document integration now uses the shared runtime in one database
   transaction. Extend conformance before covering external cloud tools.
3. Implement filesystem/Git with an explicit cooperative vs enforced boundary;
   never claim an atomic filesystem CAS that the OS interface cannot provide.
4. Add persistent multi-operation planning and resource/provenance dependencies.
5. Build provider adapters and cloud journal/transport, then budgets/staged work
   and operational evidence against the exit criteria in the original plan.

No production deployment, provider permission expansion or destructive production
operation is part of the verification reported here. Existing GUI and model
configuration remain separate from the reverse engine implementation.

## Verification checkpoint

Latest local `pnpm check`: typechecks passed; 579 package/application/script
tests passed; nine OAuth tests passed and two opt-in cloud integration tests
were skipped at that checkpoint. The three isolated cloud GUI, recovery and Prime
protocol scenarios were subsequently run successfully. The real PostgreSQL verification was rerun successfully with the
OS-backed writer mutex and relation certification checks. Fifty-three tests cover
the newly added runtime, managed SQL, MCP and SDK paths, including three separate
process tests. This does not certify unfinished work packages or production
provider integrations.

### Capacity follow-up, 2026-09-12

The CLI now uses a durable reservation-backed encrypted SQLite vault. Runtime
reserves capture/outcome/recovery slots before preparation, releases unused
slots only on confirmed failure, and retains them for unknown outcomes. Legacy
file snapshots remain readable and count toward the logical shared quota.
The new six-test suite covers capacity contention, slot identity, key rotation,
legacy compatibility, corruption, runtime refusal and a killed snapshot writer.

The isolated PostgreSQL script passed with this vault, a real SQLSTATE 40001
conflict during managed preparation and SQLSTATE 40P01 in two disposable raw
transactions. The human change remained intact. This does not claim physical
disk preallocation, automatic retention/GC or complete managed deadlock coverage.

### Local document integration, 2026-09-12

Local workbench edits, model document mutations and branch document copies now
use the shared runtime and reserved encrypted vault. The existing encrypted
workspace commits document changes with their original signed evidence. New
signed entries carry a managed runtime marker; a missing new journal cannot
silently fall back to legacy recovery. Older unmarked signed operations retain
their original Undo path. Runtime artifacts use the existing workspace key.

Five new integration tests cover sequential/repeated Undo after restart, failed
capture with no document write, human conflicts, missing runtime evidence and
legacy compatibility. At this checkpoint cloud `server.mjs`/`steps.mjs` used their original transaction
path. The cloud follow-up below supersedes that limitation for managed documents. The production workspace login was separately verified with HTTP 200.

### PostgreSQL connection faults, 2026-09-12

The isolated verifier now terminates only its own acquired PostgreSQL backend
sessions at the COMMIT boundary. Before COMMIT, both row mutation and receipt
roll back; VOID keeps an unknown outcome and refuses automatic redispatch or
recovery without evidence. After COMMIT, a fresh adapter reconciles the durable
receipt and restores the row. A terminated recovery connection after COMMIT is
also reconciled without a second recovery receipt.

A real lock cycle now includes the managed executor during dispatch. The test
accepts PostgreSQL's victim selection and checks the corresponding safe result:
unknown without redispatch when the managed transaction loses, or successful
execution and verified Undo when the competing transaction loses. This does not
claim that both victim selections were observed in one run.

Validation: `scripts/src/verify-managed-postgres.mjs` passed all thirteen reported
checks against the isolated database; syntax and diff checks passed. The fixture
removes its owned schemas and releases terminated clients without retaining error
listeners. No production data or credentials were used by this verifier. This
is connection-fault coverage, not a physical network partition, PostgreSQL server
crash, client SIGKILL test, or completion of M1. Shared-runtime cloud integration
remains the next feature work; the deployed web login is unchanged.

### Cloud documents and local Prime execution, 2026-09-12

Cloud editor writes, branch copies and agent document mutations now use the same
managed document adapter and recovery runtime as the local workbench. Encrypted
artifacts, capacity reservations, signed lifecycle events and document state share
one SQL transaction under the session lock. This is valid for managed documents
only: an external side effect must not use this transaction-bound journal. The
vault limits each artifact to 4 MiB and each session to 64 MiB of logical reserved
and retained encrypted storage; retention and key migration remain future work.
Legacy signed document Undo remains supported. A managed marker never silently
falls back to legacy recovery when artifacts or lifecycle evidence are missing.

The isolated cloud GUI and recovery tests passed, including atomic rollback,
capacity failure, missing artifacts, conflicting history, branch copies and
idempotent Undo. The local Prime worker protocol separately tests authentication,
single claim, stale-result refusal and no replay of a lost job. Prime tool calls
are outside captured document Undo; its outer run is signed as R3, and individual
tool notifications are informational rather than captured recovery receipts.

## Cooperative filesystem and public demo, 2026-09-13

The managed filesystem adapter and CLI/MCP configuration now support one regular file with bytes and mode recovery. Real filesystem tests cover binary data, restart, idempotence, human edits, ABA, permissions and unsafe paths. Missing atomic filesystem receipts leave uncertain outcomes unknown. This is not completion of R05.

The public demo uses visitor-scoped managed cloud documents and a fixed TokenRouter model, without exposing private workspace or Prime credentials. Mobile controls use consistent SVG dimensions and a named native dialog. Research and the larger design sequence are recorded in `GUI-DESIGN-RESEARCH.md`.
