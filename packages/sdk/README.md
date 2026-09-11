# @void/sdk

In-process SDK wrapper for VOID.

## Responsible for

`@void/sdk` lets application code use the same proxy, policy, hold, and ledger path without shelling out to the development binary. It presents a small MCP-like client and maps common safety failures to typed errors.

This package is landing in wave 4. Its README documents only the public barrel exported by `src/index.ts`.

## Must never do

- Reimplement classification, policy, replay, or ledger verification.
- Hide a failed ledger verification and continue.
- Invent a default allow policy.
- Store or print secrets from upstream headers or tool arguments.
- Treat development approvals as authenticated user identity.

## Public surface

- `VoidClient`, `createVoidClient`
- `McpLikeClient`, `VoidClientOptions`, `VoidClock`, `VoidConnect`
- `holdHandle`, `HoldHandle`, `HoldHandleOptions`
- `HoldDeniedError`, `LedgerVerifyError`, `PolicyStartupError`, `RefusedError`
- `RefusalReason`, `VoidErrorCode`

## Upstreams

`VoidConnect` supports two shapes:

```ts
{ upstreamCommand: ["node", "server.mjs"], upstreamEnv: {} }
{ httpUrl: "http://127.0.0.1:3000/mcp", headers: {} }
```

## Safety behavior

- Existing ledger files have their hash chain and signatures verified before
  upstream startup, using the same configured development signer as the proxy.
  Unknown signing keys and forged signatures cause `LedgerVerifyError`.
- Missing policy defaults to a temporary deny-all policy.
- Holds are exposed through the approval broker and hold handles.
- Denied or expired holds throw `HoldDeniedError`.
- Invalid policy startup throws `PolicyStartupError`.
- Invalid ledger startup throws `LedgerVerifyError`.
- Replay refusal reports can be converted to `RefusedError`.

See `docs/SDK.md` for usage notes.

## Managed execution

`managedClient({ workspace, agentId, journal, vault, adapters, authorize })`
wraps the shared recovery runtime. Its methods are `execute(adapterId,
operationId, runId, arguments)`, `planRecovery(operationId)`,
`recover(plan, authorize)`, `reconcile(operationId)` and
`reconcileRecovery(operationId)`. The host supplies authorization; there is no
default allow. Operation IDs must remain stable across retries.

This is separate from the legacy `VoidClient` interception API. Only registered
executable `RecoveryAdapter` implementations provide managed capture and
recovery. See `docs/MANAGED-RECOVERY.md` and `docs/RECOVERY-COVERAGE.md`.
