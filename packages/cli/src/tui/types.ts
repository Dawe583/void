export type ReversibilityClass = "r0" | "r1" | "r2" | "r3";

export type CallDecision = "allow" | "hold" | "deny";

export type CallStatus =
  "observed" | "sealed" | "pending" | "cancelled" | "failed";

export type PipelineStage = "intent" | "classify" | "decide" | "seal";

export interface InterceptedCall {
  readonly id: string;
  readonly time: string;
  readonly tool: string;
  readonly connector: string;
  readonly agent: string;
  readonly workspace: string;
  readonly class: ReversibilityClass;
  readonly decision: CallDecision;
  readonly status: CallStatus;
  readonly stage: PipelineStage;
  readonly blastRadius: number | null;
  readonly policyRule: string;
  readonly durationMs: number;
  readonly inverse: string | null;
  readonly compensation: string | null;
  readonly snapshotRef: string | null;
  readonly ledgerHash: string | null;
  readonly reason: string;
}

export interface PendingHold {
  readonly call: InterceptedCall;
  readonly openedAt: number;
  readonly expiresAt: number;
  readonly approver: string | null;
}

export type ResolvedState = "approved" | "denied" | "expired";

export interface ResolvedHold {
  readonly hold: PendingHold;
  readonly state: ResolvedState;
  readonly resolvedAt: number;
  readonly by: string | null;
}

export interface ServiceHealth {
  readonly proxy: "healthy" | "degraded" | "offline";
  readonly upstream: "healthy" | "degraded" | "offline";
  readonly ledger: "verified" | "unverified" | "broken";
  readonly connector: "ready" | "degraded" | "offline";
  readonly latencyMs: number;
}

export interface LedgerSummary {
  readonly entries: number;
  readonly verifiedThrough: number;
  readonly head: string;
  readonly keyId: string;
  readonly checkpointAgeSeconds: number;
}

export interface SessionSummary {
  readonly id: string;
  readonly agent: string;
  readonly workspace: string;
  readonly transport: "stdio" | "http";
  readonly posture: "enforce" | "observe";
  readonly startedAt: number;
}

export interface DashboardState {
  readonly session: SessionSummary;
  readonly health: ServiceHealth;
  readonly ledger: LedgerSummary;
  readonly calls: readonly InterceptedCall[];
  readonly holds: readonly PendingHold[];
  readonly resolvedHolds?: readonly ResolvedHold[];
  readonly selectedCallId: string | null;
  readonly paused: boolean;
  readonly filter: ReversibilityClass | "all";
}

export interface ReplayStep {
  readonly order: number;
  readonly callId: string;
  readonly tool: string;
  readonly target: string;
  readonly class: ReversibilityClass;
  readonly action: string;
  readonly precondition: string;
}

export interface ReplayPlan {
  readonly workspace: string;
  readonly to: string;
  readonly steps: readonly ReplayStep[];
  readonly blocked: readonly string[];
  readonly snapshotBytes: number;
}

export interface VerificationSummary {
  readonly valid: boolean;
  readonly developmentKey: boolean;
  readonly entries: number;
  readonly verifiedThrough: number;
  readonly head: string;
  readonly keyId: string;
  readonly bodyFailures: readonly number[];
  readonly linkFailures: readonly number[];
  readonly signatureFailures: readonly number[];
}

export interface TerminalCapabilities {
  readonly interactive: boolean;
  readonly ansi: boolean;
  readonly colorDepth: 0 | 4 | 8 | 24;
  readonly columns: number;
  readonly rows: number;
  readonly reason: "interactive" | "not-tty" | "dumb" | "no-color" | "ci";
}

export interface Renderer {
  renderCall(call: InterceptedCall, capabilities: TerminalCapabilities): string;
  renderDashboard(
    state: DashboardState,
    capabilities: TerminalCapabilities,
    now?: number,
  ): string;
  renderHold(
    hold: PendingHold,
    capabilities: TerminalCapabilities,
    now?: number,
  ): string;
}
