# VOID SDK

This document describes the public barrel exported by `@void/sdk`. The surface is a release candidate covered by package tests and the whole-product arc script.

## Purpose

The SDK is for app builders who want VOID in process instead of only as a stdio proxy binary. It wraps the proxy, ledger verification, policy startup, and approval broker behind a small MCP-like client.

## Public exports

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `VoidClient` | class | In-process client that sends MCP requests through VOID. |
| `createVoidClient` | function | Convenience constructor for `VoidClient`. |
| `McpLikeClient` | type | Minimal client shape with `request` and `awaitHold`. |
| `VoidClientOptions` | type | Options for ledger, workspace, upstream, policy, facts, posture, and timeouts. |
| `VoidConnect` | type | Upstream choice: stdio command or HTTP URL. |
| `VoidClock` | type | Injectable clock for tests. |
| `holdHandle` | function | Promise-like handle for a pending approval record. |
| `HoldHandle` | type | Promise-like hold handle with `holdId` and `decide`. |
| `HoldHandleOptions` | type | Polling and clock options for hold handles. |
| `HoldDeniedError` | class | Error for denied or expired holds. |
| `LedgerVerifyError` | class | Error for a ledger that fails startup verification. |
| `PolicyStartupError` | class | Error for policy load or validation failure. |
| `RefusedError` | class | Error wrapper for replay refusal reports. |
| `VoidErrorCode` | type | String union of SDK error codes. |
| `RefusalReason` | type | Replay refusal reason. |

## Client options

`VoidClientOptions` accepts:

- `ledgerDir`: local ledger directory. Defaults to the ledger package default.
- `workspace`: workspace name. Defaults to `default`.
- `connect`: upstream command or HTTP URL.
- `policyPath`: policy YAML. If omitted, the SDK creates a deny-all temporary policy.
- `factsPath`: optional facts file.
- `posture`: proxy posture. Defaults to `fail-closed`.
- `requestTimeoutMs`: request timeout. Defaults to 60000.
- `holdPollMs`: hold polling interval. Defaults to 10.
- `clock`: injectable timer boundary.

## Stdio upstream example

```ts
import { createVoidClient, HoldDeniedError } from "@void/sdk";

const client = createVoidClient({
  connect: { upstreamCommand: ["node", "fixtures/e2e-server.mjs"] },
  policyPath: "fixtures/e2e-policy.yaml",
  ledgerDir: "/tmp/void-ledger",
  workspace: "demo",
});

try {
  const result = await client.request("tools/call", {
    name: "echo",
    arguments: { text: "hello void" },
  });
  console.log(result);
} catch (error) {
  if (error instanceof HoldDeniedError) {
    console.error(error.message);
  }
  throw error;
} finally {
  client.close();
}
```

## HTTP upstream example

```ts
import { createVoidClient } from "@void/sdk";

const client = createVoidClient({
  connect: {
    httpUrl: "http://127.0.0.1:3000/mcp",
    headers: { authorization: "Bearer development-token" },
  },
  policyPath: "policy/default.yaml",
  ledgerDir: "/tmp/void-ledger",
  workspace: "demo",
});
```

## Holds

The client exposes pending holds through its approval broker.

```ts
const pending = client.pendingHolds();
const first = pending[0];
if (first !== undefined) {
  const handle = client.hold(first.holdId);
  handle.decide({ kind: "approved", by: "operator" });
  await handle;
}
```

`awaitHold(holdId)` resolves or rejects with the original request result. `hold(holdId)` resolves to the approval record.

## Error codes

| Class | Code |
| ----- | ---- |
| `HoldDeniedError` | `VOID_HOLD_DENIED` |
| `LedgerVerifyError` | `VOID_LEDGER_VERIFY` |
| `PolicyStartupError` | `VOID_POLICY_STARTUP` |
| `RefusedError` | `VOID_REFUSED` |

## Startup safety

Before starting the proxy, `VoidClient` verifies the hash chain and signatures of an existing workspace ledger file. It trusts the same signer configuration as the proxy: `VOID_SIGNING_KEY` when configured, otherwise the local development key in `~/.void/keys`. Ledger entries cannot introduce a trusted key. A lost or replaced signing key therefore prevents startup against the old ledger; multi-key rotation is not supported. If verification fails, it throws `LedgerVerifyError` and refuses to run. If no policy path is provided, it writes a temporary deny-all policy instead of silently allowing writes.

## Holds across processes

The in-process broker has no state directory, so decisions made through the SDK apply only while the client runs. A proxy started with `--approvals-dir` shares its holds through the state directory instead, and the `void approve` CLI decides those from any process. The whole-product arc script shows both surfaces in one run.

## Current limitations

- It wraps current proxy behavior. It is not a separate policy engine.
- It uses the dev-tier local ledger store by default.
- Approval identity is not authenticated in this repo.
- Public package installation is not final while packages remain private.
