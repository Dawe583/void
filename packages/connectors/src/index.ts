/**
 * Connectors: one per tool surface, each knowing how to snapshot the state a
 * call is about to change and how to build the inverse of that call.
 *
 * This file carries the descriptor resolution seam: the proxy holds connector ids and
 * looks a connector up in a list it is handed, so it never imports a connector
 * directly and adding a tool surface stays additive.
 */

export type ConnectorId = string;

export interface ConnectorDescriptor {
  readonly id: ConnectorId;
  /** Registry entry id prefix this connector answers for, for example "postgres.row". */
  readonly surface: string;
}

/** Compatibility alias for descriptor consumers. Execution uses RecoveryAdapter;
 * legacy capture/apply integrations use registry.ts Connector. */
export type Connector = ConnectorDescriptor;
export type { RecoveryAdapter, Observation, Reversibility, Readiness } from './recovery.ts';

/**
 * Takes the list as a parameter rather than reading a module level registry:
 * that is what keeps this package free of any import of a concrete connector,
 * and it is what makes the proxy's wiring visible at its call site instead of
 * hidden in a side effect at import time.
 */
export function findConnector(available: readonly Connector[], id: ConnectorId): Connector | undefined {
  return available.find((connector) => connector.id === id);
}

/** Duplicate ids are a configuration error, not a last one wins. */
export function assertUniqueIds(available: readonly Connector[]): void {
  const seen = new Set<ConnectorId>();
  for (const connector of available) {
    if (seen.has(connector.id)) {
      throw new Error(`duplicate connector id ${JSON.stringify(connector.id)}`);
    }
    seen.add(connector.id);
  }
}
