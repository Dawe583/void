# @void/runtime

Shared managed execution and recovery, currently local and experimental.

The runtime records a signed lifecycle, encrypts before images, binds requests
and plans to digests, and refuses silent retries after uncertain outcomes.
Adapters own transaction/CAS protection and durable reconciliation evidence.

Entry point: `src/index.ts`. Executable adapter contract:
`../connectors/src/recovery.ts`. CLI: `void recovery`.

Read `../../docs/RECOVERY-CONTRACT.md`, `../../docs/RECOVERY-COVERAGE.md` and
`../../docs/MANAGED-RECOVERY.md` before configuring a target. This package does
not turn arbitrary tools, shell commands or OAuth connections into reversible
operations.

Run `pnpm --filter @void/runtime test` and `pnpm --filter @void/runtime typecheck`.

`reservedRecoveryVault` is the CLI default. It atomically stores encrypted
artifacts and quota reservations in SQLite. `localRecoveryVault` remains the
legacy file implementation; callers choosing it do not gain total capacity
reservation. Both implement the same runtime vault interface.
