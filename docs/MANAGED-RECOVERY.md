# Managed PostgreSQL recovery

This local executor supports an explicitly configured subset of PostgreSQL row
mutations. Read RECOVERY-COVERAGE.md before enabling it. Start against a disposable
database. No installation or production mutation runs automatically.

## Configuration

Create a private configuration file. Paths are relative to that file; credentials
are read from named environment variables, never embedded in the configuration.

```json
{
  "workspace": "demo",
  "agentId": "opencode-local",
  "stateDir": "./recovery-state",
  "encryptionKeyEnv": "VOID_RECOVERY_KEY",
  "vaultCapacity": {"maxArtifactBytes": 67108864, "maxTotalBytes": 1073741824},
  "policyPath": "./recovery-policy.yml",
  "postgres": {
    "urlEnv": "VOID_DATABASE_URL",
    "schema": "void_recovery",
    "tables": [
      {"table": "public.account", "primaryKey": ["id"], "columns": ["balance", "note"]}
    ]
  }
}
```

Supply a stable random 32-byte base64 `VOID_RECOVERY_KEY` through your private
secret store and a direct PostgreSQL connection in `VOID_DATABASE_URL`. Retain
that key across restarts. The executor creates persistent local signing keys in
`stateDir/keys`; back them up with the vault and journal. Do not commit any keys,
connection strings, snapshots or state directories.

Explicit installation adds metadata tables and a revision trigger to configured
tables. Use the operator role intended for installation:

```sh
node packages/cli/bin/void.mjs recovery install --config recovery.json
```

Use a constrained execution role in deployment. PostgreSQL metadata currently
contains plaintext capture and outcome data and must be protected accordingly.
The initial metadata schema has no released upgrade migration; do not reuse an
older experimental schema without reviewing its definition.

## Capacity and migration

The CLI stores new encrypted snapshots in `stateDir/vault/vault.sqlite`.
It reserves room for capture, outcome and recovery before starting a mutation.
The configured quota includes encrypted payload bytes and outstanding reserved
slots, across all workspaces sharing this vault. SQLite/file overhead is extra;
this does not preallocate physical disk space. Each artifact uses its configured
maximum reservation until its actual size is known.

Set limits before first use. Limits persist; another worker cannot bypass them
by opening the same vault with larger values. Changing an existing vault's
capacity needs an explicit administrative migration, not a configuration edit.
Unknown operations keep reservations. Reconciliation consumes the original slot
and returns the same stored artifact on retry. No automatic GC deletes history.

Old file snapshots remain readable and count toward the quota. Stop all older
executors before switching; do not run old and new vault writers together.
Keep encryption keys, existing files and the SQLite database in your backup.

## Operator workflow

An execution input has stable identities and structured arguments:

```json
{
  "workspace": "demo",
  "operationId": "adjust-account-1",
  "agentId": "opencode-local",
  "runId": "session-1",
  "adapterId": "postgres-managed-demo",
  "arguments": {
    "table": "public.account",
    "action": "update",
    "key": {"id": 1},
    "values": {"balance": 20}
  }
}
```

1. `void recovery inspect --config recovery.json --input request.json` produces
   the exact preflight and approval digest. Review the scope and target.
2. `void recovery execute --config recovery.json --input request.json --approve DIGEST`
   applies only the reviewed request and state. A changed revision refuses it.
3. `void recovery plan --config recovery.json --input request.json` prints the
   recovery plan. Save that JSON as `plan.json` and review it.
4. `void recovery apply --config recovery.json --input plan.json --approve PLAN_DIGEST`
   restores the captured row if it still matches the operation's after state.
5. For unknown results, use `reconcile` for execution or `reconcile-recovery`
   for Undo, with the original input file. Neither repeats the mutation.

Use `node packages/cli/bin/void.mjs` wherever the `void` binary is not installed.
Never generate a new operation ID merely because a response was lost.

## MCP connection

Run `void recovery serve --config recovery.json` as a local stdio MCP server.
Use an absolute config path in the host launch command. The host must pass the
credential environment variables to the child process. The model never receives
them as tool arguments.

The five tools are `void_execute`, `void_recovery_plan`, `void_recovery_apply`,
`void_reconcile`, and `void_recovery_reconcile`. Workspace, adapter and agent
identity come from operator configuration. The model supplies a stable run ID
and operation ID. A plan digest is an integrity binding, not approval.

Example policy for this single-row test workspace:

```yaml
version: 1
rules:
  - match:
      workspace: demo
      connector: postgres
      tool: [void_execute, void_recovery_apply, void_reconcile, void_recovery_reconcile]
      class: r1
      blast_radius: {lt: 2}
    decision: allow
  - match:
      workspace: demo
      tool: void_recovery_plan
    decision: allow
  - match: {}
    decision: deny
```

This policy authorizes automatic execution and Undo in the configured subset.
Use deny if operator approval is required. Missing/invalid policy, deny and hold
all refuse through this server; interactive approval hold is not wired here yet.
The standalone CLI digest workflow is available to the operator. No timer or
agent-provided flag turns a hold into permission.

This local transport is suitable for local MCP hosts. It is not an authenticated
public HTTP endpoint for claude.ai or the Vercel chat application.

## Failure handling

- `unknown`: preserve the original identity and reconcile; no blind retry.
- `conflict`: keep the human change. The current release does not automatically
  replan a conflicting operation or force overwrite it.
- Invalid journal or missing key: stop recovery and restore verified backups.
- Killed writer: the OS-backed SQLite mutex releases automatically. The next
  executor reconciles uncertain operations. Never remove `.writer.sqlite` while
  an executor may be running. A legacy `.runtime.lock` requires migration review.
- `reason: "recovery-capacity"`: the artifact or total logical quota was exceeded.
  A failed operation did not dispatch; an unknown operation must be reconciled.
- Disk full: capture failure prevents dispatch; failure after commit is unknown.
  Free space without deleting recovery artifacts, then reconcile.

Run the offline suite with `pnpm test:reverse`. The real database verification
script requires `VOID_RECOVERY_DATABASE_TEST=1`, a direct `DATABASE_URL` targeting
`void_gui_upgrade_preview`, and creates/removes only its uniquely named schemas.
It deliberately terminates only database sessions acquired by the fixture,
before/after execution COMMIT and after recovery COMMIT. It also exercises a real
deadlock during managed dispatch. A missing receipt after connection loss remains
unknown; absence alone cannot authorize a repeated write. The verifier does not
partition the network, kill the PostgreSQL server, or certify client process death.
