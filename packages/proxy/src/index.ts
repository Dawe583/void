/**
 * The MCP proxy: an agent's server, an upstream server's client, and nothing
 * else in between that the session can notice.
 *
 * The stdio and HTTP transports share the same interception path. What is
 * fixed here is the posture, because it is the decision the rest of the
 * interception path is written against: an unknown tool, an unclassified call,
 * a ledger append failure, an invalid policy file or an internal error all
 * resolve to deny. Observe only is an explicit opt in, never a fallback.
 */

/** Deny on anything unexpected, or forward and record without ever blocking. */
export type Posture = "fail-closed" | "observe-only";

export const DEFAULT_POSTURE: Posture = "fail-closed";

export type Transport = "stdio" | "http";

export const SUPPORTED_TRANSPORTS: readonly Transport[] = ["stdio", "http"];

export function isSupportedTransport(name: string): name is Transport {
  return (SUPPORTED_TRANSPORTS as readonly string[]).includes(name);
}

// WP-01 modules. The transport owns the process boundary, the session owns
// the id and token maps, the forwarders own the tools/call decision path and
// the read-only passthroughs, the relays own notification and server
// request translation. The binary composes them; nothing imports sideways.
// Re-export explicitly: several modules re-export shared rpc.ts types, and
// star exports would collide on them. One name, one owning module here.
export * from "./rpc.ts";
export * from "./session.ts";
export * from "./transport/stdio.ts";
export * from "./transport/http.ts";
export * from "./forward/tools.ts";
export { forwardResourceMessage, relayResourceNotification } from "./forward/resources.ts";
export { forwardPromptMessage, relayPromptNotification } from "./forward/prompts.ts";
export * from "./relay/notifications.ts";
export * from "./relay/requests.ts";
export * from "./relay/http-requests.ts";
export * from "./approval-loop.ts";
export * from "./hardening.ts";
