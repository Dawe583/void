/** Shared executable contract. Classification metadata alone is not an adapter. */
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Effect =
  "read" | "write" | "external-disclosure" | "mixed" | "unknown";
export type Reversibility = "r0" | "r1" | "r2" | "r3" | "unknown";
export type Readiness =
  | "verified"
  | "conditional"
  | "expired"
  | "unsupported"
  | "unknown-outcome"
  | "conflict";
export type Observation = {
  effect: Effect;
  reversibility: Reversibility;
  readiness: Readiness;
  scope: string;
  resources: string[];
  revision: Json;
  blastRadius: {
    count: number | null;
    precision: "exact" | "bounded" | "unknown";
  };
};
export type Prepared = { before: Json; plan: Json };
export type Outcome = { result: Json; evidence: Json };
export type Reconciliation =
  | { status: "unknown" }
  | { status: "failed" }
  | { status: "succeeded"; outcome: Outcome };
export type RecoveryOutcome = {
  status: "restored" | "compensated" | "conflict";
  evidence: Json;
};
export interface RecoveryAdapter {
  readonly id: string;
  readonly version: string;
  preflight(args: Json): Promise<Observation>;
  /** Must revalidate observation and own atomicity/CAS at the actual write boundary. */
  prepare(
    args: Json,
    observation: Observation,
    operationId: string,
  ): Promise<Prepared>;
  execute(
    args: Json,
    prepared: Prepared,
    operationId: string,
  ): Promise<Outcome>;
  /** Releases preparation resources before dispatch or after an execution error. Never retries. */
  release(operationId: string): Promise<void>;
  reconcile(operationId: string, prepared: Prepared): Promise<Reconciliation>;
  /** Must guard against drift and verify the declared scope before reporting restored. */
  recover(
    prepared: Prepared,
    outcome: Outcome,
    recoveryId: string,
  ): Promise<RecoveryOutcome>;
  /** Read durable recovery evidence only. An absent receipt never authorizes another inverse. */
  reconcileRecovery?(
    prepared: Prepared,
    outcome: Outcome,
    recoveryId: string,
  ): Promise<RecoveryOutcome | { status: "unknown" }>;
}
