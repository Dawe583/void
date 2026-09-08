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

- Existing ledger files are verified before startup.
- Missing policy defaults to a temporary deny-all policy.
- Holds are exposed through the approval broker and hold handles.
- Denied or expired holds throw `HoldDeniedError`.
- Invalid policy startup throws `PolicyStartupError`.
- Invalid ledger startup throws `LedgerVerifyError`.
- Replay refusal reports can be converted to `RefusedError`.

See `docs/SDK.md` for usage notes.
