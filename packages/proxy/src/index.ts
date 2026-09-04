/**
 * The MCP proxy: an agent's server, an upstream server's client, and nothing
 * else in between that the session can notice.
 *
 * Nothing is implemented yet. WP-01 lands the stdio transport and the core
 * message path, WP-02 the streamable HTTP transport. What is fixed here is the
 * posture, because it is the decision the rest of the interception path is
 * written against: an unknown tool, an unclassified call, a ledger append
 * failure, an invalid policy file or an internal error all resolve to deny.
 * Observe only is an explicit opt in, never a fallback.
 */

/** Deny on anything unexpected, or forward and record without ever blocking. */
export type Posture = "fail-closed" | "observe-only";

export const DEFAULT_POSTURE: Posture = "fail-closed";

export type Transport = "stdio" | "streamable-http";

/**
 * Phase 1 is stdio only. Streamable HTTP means an inbound listener, session
 * identifiers, Origin and DNS rebinding validation, TLS and bearer auth in
 * front of someone's database: a second security surface opened in the same
 * week the forwarding logic is written for the first time.
 */
export const SUPPORTED_TRANSPORTS: readonly Transport[] = ["stdio"];

export function isSupportedTransport(name: string): name is Transport {
  return (SUPPORTED_TRANSPORTS as readonly string[]).includes(name);
}
