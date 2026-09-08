# The proxy interface, WP-01 frozen design

Three designs were weighed against the same requirement list, drawn from the
message inventory (docs/message-inventory.md) and the traps it names: id and
progress-token remapping in both directions, cancellation by translated request
id, version re-negotiation upstream, the proxy never timing out before the
agent, the 10 MiB line ceiling, and a hold that blocks a real response.

- **A, minimal surface.** One `Proxy` class owns transport, session and
  forwarding. Fewest exports, but the hold queue, the ledger tap and the
  classify call all become private state a test can only reach by driving a
  full stdio session, and the WP-11 observability story has no seam to hang
  on. Rejected for testability, not for size.
- **B, max observability.** Every message crosses an event emitter before it
  is forwarded; the ledger, the hold and the CLI approvals all subscribe.
  The seam is right, but an emitter per message makes the hot path async
  ordering work, and one slow subscriber can stall a notification that must
  pass through immediately. Rejected for the hot path cost.
- **C, transport interface first.** stdio specifics behind an interface HTTP
  can reuse in WP-02. Correct eventually, but WP-02 has not been designed
  and inventing that interface now means guessing at a second transport's
  needs. Rejected as speculative, the plan's own 7.2 warning.

**The decision: B's seam without B's emitter.** The proxy is a pipeline of
small single-purpose modules connected by plain function calls and typed
values, with one async event surface: the held call. Everything else is a
synchronous pass-through or a function the pipeline calls. This keeps every
module unit-testable with plain inputs, keeps the hot path free of
subscriber fan-out, and leaves the transport split to WP-02 where it
belongs. Id remapping is not a module: it is a pair of maps the session owns
and the forwarders must consult.

## Modules

| Module | One responsibility |
| ------ | ------------------ |
| `src/transport/stdio.ts` | Own the process boundary: spawn the upstream, frame lines, enforce the 10 MiB ceiling, forward stderr, signal ladder. |
| `src/session.ts` | Own the conversation state: id maps both directions, progress-token remap, negotiated version, capabilities passthrough, in-flight cancellation. |
| `src/forward/tools.ts` | Intercept `tools/call`: classify through the registry, ask policy, record, hold, deny or forward. |
| `src/forward/resources.ts`, `src/forward/prompts.ts` | Read-only surfaces forward untouched, after the session validates framing. |
| `src/relay/notifications.ts` | Every notification and server-to-client request relays with ids and tokens translated, nothing dropped. |

The proxy binary composes them; no module imports another's internals.

## The flow, in text

### Initialize

    agent -> proxy: initialize { protocolVersion: P, capabilities }
    proxy: open upstream, send initialize { protocolVersion: P }
    upstream -> proxy: initialize result { protocolVersion: U }
    proxy: if U in agent's supported set, answer U, else answer the latest
           the agent supports; capabilities pass through verbatim
    agent -> proxy: notifications/initialized -> forward verbatim

The proxy never forwards the upstream's version answer verbatim; the
inventory's trap 2 says the negotiation is asymmetric and the agent must end
up on a version it supports.

### A tools/call

    agent -> proxy: tools/call { name, arguments, _meta.progressToken }
    session: allocate upstream id U, record agent id A -> U, remap token
    classify: registry entry + declared facts -> class or assume
    policy: decide(class, blast radius, connector) -> allow | deny | hold
    allow: forward, stream progress back with the token remapped to A
    deny:  answer a JSON-RPC error naming rule, class, rationale
    hold:  park the promise; the response returns when a human resolves
           or the timer fires, and the answer is the hold error body
    ledger: one append per decided call, digest only, never the payload

### A cancellation in flight

    agent -> proxy: notifications/cancelled { requestId: A }
    session: look up A -> U; if U exists, forward cancelled { requestId: U },
             drop the mapping, resolve the parked promise as cancelled
    upstream -> proxy: notifications/cancelled { requestId: U } is the
             mirror case for server-initiated cancellation of a sampling
             or roots request the proxy forwarded

A lost mapping makes the cancel a no-op upstream and the parked call still
answers on its own timer, so the agent is never left hanging on a promise
the proxy dropped.

### A held call, resolved

    proxy parks the tools/call response on the HoldQueue promise
    `void approvals` renders the queue, y/n resolves
    approved: forward the call now, response flows back, ledger records both
    denied:  answer the hold error body, do not forward, ledger records both

## Exports, the frozen contract

```ts
// transport/stdio.ts
export type UpstreamProcess = {
  readonly send: (line: string) => void;
  readonly close: () => void;
  readonly onStderr: (chunk: string) => void;
};
export function spawnUpstream(
  command: readonly string[],
  env: Readonly<Record<string, string>>,
): UpstreamProcess;

// session.ts
export type SessionMaps = {
  /** agent id to upstream id, the tools/call direction. */
  readonly agentToUpstream: ReadonlyMap<number, number>;
  /** upstream id to agent id, server-initiated requests. */
  readonly upstreamToAgent: ReadonlyMap<number, number>;
};
export class Session {
  allocateAgentId(): number;
  /** Remaps both id and progress token; returns the upstream request object. */
  translateRequestOut(agentRequest: JsonRpcRequest): JsonRpcRequest;
  /** Translates a notification or server request coming back. */
  translateInbound(message: JsonRpcMessage): JsonRpcMessage | null;
  /** Version the proxy answers the agent with, never the upstream's verbatim. */
  negotiatedVersion(requested: string, upstreamAnswer: string): string;
  drop(agentId: number): void;
  readonly maps: SessionMaps;
}

// forward/tools.ts
export type InterceptedCall = {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly connector: string;
};
export type CallVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly error: JsonRpcError }
  | { readonly kind: "hold"; readonly promise: Promise<JsonRpcResult | JsonRpcError> };
export function interceptCall(
  call: InterceptedCall,
  deps: { classify: () => ClassifiedCall; policy: () => PolicyDecision; hold: (seconds: number) => Promise<HoldResolution>; ledger: (entry: LedgerEntryInput) => void },
): CallVerdict;

// relay/notifications.ts
export function relayNotification(
  notification: JsonRpcNotification,
  session: Session,
): JsonRpcNotification | null;
```

`JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResult`, `JsonRpcError` are
plain structural types the proxy defines itself; it does not import SDK
types into its public surface, so the SDK can move without a breaking change.

## What the proxy never does

Store a payload. The ledger records digests, the hold queue keeps arguments
in memory for the approver to read and nothing else.

Reuse an id. Ids are allocated once per direction and dropped when the
response lands or the cancel arrives; a dropped mapping is deleted, never
re-rolled.

Time out before the agent. The 60 second SDK default belongs to the ends of
the wire; the proxy forwards the agent's own timeout context and never lets
an internal timer fire first (inventory trap 4).

Advertise a capability the upstream lacks. The initialize result the agent
sees is the intersection, and the proxy adds none of its own, because the
agent's capability assertions will fail against a proxy that lied.
