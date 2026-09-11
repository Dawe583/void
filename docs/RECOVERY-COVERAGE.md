# Recovery coverage

Status: implementation in progress, 2026-09-12. This is a capability inventory,
not a declaration that all work packages in REVERSE-TOOL-UPGRADE-PLAN are done.

| Surface | Managed support | Scope / constraints | Evidence |
| --- | --- | --- | --- |
| PostgreSQL INSERT/UPDATE/DELETE | Implemented, restricted R1 | One explicitly configured primary-key row; configured writable columns; exact row values restored | `packages/connectors/src/postgres/managed.test.ts`, `managed-adversarial.test.ts` |
| PostgreSQL human ABA | Detected | Installed revision trigger and relation identity; disabled/replaced trigger refuses execution | Same suites |
| Lost mutation/recovery response | Reconciliation | Durable transaction receipt bound to capture and outcome; no automatic second dispatch | Same suites; runtime tests |
| Local encrypted snapshots | Implemented subset | AES-256-GCM, workspace AAD, digest, durable reserved slots, shared 1 GiB logical quota; legacy reads | `packages/runtime/src/{runtime,adversarial,reserved-vault}.test.ts` |
| Signed lifecycle / idempotence | Implemented subset | Local single writer; corruption fails closed; OS-backed local writer mutex, SIGKILL recovery | Same suites |
| Managed MCP tools | Implemented subset | Local stdio, operator policy, configured workspace and agent identity | `packages/cli/src/recovery-mcp.test.ts` uses official MCP client/in-memory transport |
| Real PostgreSQL | Verified subset | Isolated Neon database; separate connections, ABA, restart, injected lost commit response | `scripts/src/verify-managed-postgres.mjs` |
| Legacy PostgreSQL/S3 replay | Existing separate path | Earlier capture/apply contract; no automatic managed-runtime guarantees | `REVERSE-ENGINE-VALIDATION.md` |
| Local workbench documents | Shared runtime integrated | Writes, deletes, branch copies and operator Undo; legacy signed history preserved | `packages/workbench/src/managed-documents.test.ts` |
| Filesystem/Git managed execution | Pending | No general shell or coding-agent restore claim | WP-R05 |
| GitHub/Vercel/Supabase OAuth | Connection mechanism only | Provider consent and service scopes do not certify recovery | `OAUTH-INTEGRATIONS.md` |
| Local R3 budget | Implemented subset | UTC authorization-day, workspace and per-agent limits, durable reservations | `packages/runtime/src/budget.test.ts`, 100-request contention |
| Cross-system jobs, provenance, cloud budgets, staged cancel | Pending integration | Existing taint/policy modules do not satisfy these work packages alone | WP-R06 through R14 |

## PostgreSQL limitations

The initial adapter rejects inbound foreign keys, generated/identity columns,
additional user triggers, RLS, rules, partitioned relations and disabled or
substituted revision triggers. It does not support arbitrary SQL, bulk predicates, DDL, sequence restoration or
external observers. Real SERIALIZABLE conflict during managed prepare is tested.
The isolated deadlock test uses raw PostgreSQL transactions; it does not certify
managed deadlock handling. Cascade, RLS/tenant certification and killed database
connection scenarios remain release gates.

Installation creates a configured metadata schema and row revision triggers.
It is an explicit operator command, never automatic on connection. Metadata
contains before images and outcomes in PostgreSQL; protect its privileges and
backups as sensitive data. Local artifact encryption does not encrypt this
transactional database evidence.

## Verification interpretation

The current focused suite has 53 passing tests: 30 runtime, 15 managed SQL,
two MCP integration scenarios, one managed SDK scenario and five local document tests. These are in
addition to earlier tests.
The real PostgreSQL verification passed after the capture-binding and trigger
integrity fixes. Its lost-response test injects an error after actual commit;
it is not a physical network partition or killed-worker test. A separate local
runtime test sends actual SIGKILL after dispatch. MCP integration uses the actual signed runtime with a test adapter; it is not a live OpenCode
session or cloud transport conformance test.

Capacity verification includes an actual SIGKILL before the SQLite snapshot
commit: payload and quota roll back together, and a restarted writer retains
the original reservation. The opt-in real PostgreSQL script also runs using
the reservation-backed vault.
