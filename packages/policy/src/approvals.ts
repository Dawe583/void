/**
 * Approval state stays outside HoldQueue so HTTP, Slack and the terminal
 * cannot learn different decision rules. The broker has no timers by design:
 * the proxy or API server pumps expire(), which keeps tests deterministic and
 * makes a stalled event loop fail closed through the original hold timeout.
 */

import type { HeldCall, HoldId, HoldQueue, HoldResolution, Release } from "./hold.ts";
import type { PolicyCall } from "./decide.ts";
import type { NotifyChannel } from "./rules.ts";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ApprovalDecision = {
  readonly kind: "approved" | "denied";
  readonly by: string;
  readonly reason?: string;
};

export type ApprovalRecord = {
  readonly holdId: HoldId;
  readonly call: PolicyCall;
  readonly expiresAt: number;
  readonly status: ApprovalStatus;
  readonly notify: readonly NotifyChannel[];
  readonly by?: string;
  readonly reason?: string;
};

export type ApprovalNotification = {
  readonly holdId: HoldId;
  readonly call: PolicyCall;
  readonly expiresAt: number;
  readonly notify: readonly NotifyChannel[];
  readonly held: HeldCall;
};

export type ApprovalChannel = {
  readonly notify: (approval: ApprovalNotification) => void;
};

export type ApprovalBrokerOptions = {
  readonly channels?: Partial<Record<NotifyChannel, ApprovalChannel>>;
};

type ExpirableQueue = {
  readonly clearTimer: (id: HoldId) => void;
  readonly finish: (id: HoldId, outcome: HoldResolution["outcome"]) => void;
};

export class ApprovalBroker {
  private readonly approvals = new Map<HoldId, ApprovalRecord>();
  private readonly queues = new Map<HoldId, HoldQueue>();
  private readonly channels: Partial<Record<NotifyChannel, ApprovalChannel>>;

  constructor(options: ApprovalBrokerOptions = {}) {
    this.channels = options.channels ?? {};
  }

  register(queue: HoldQueue, call: PolicyCall): ApprovalRecord {
    const held = this.findUnregisteredHold(queue, call);
    const record: ApprovalRecord = {
      holdId: held.id,
      call,
      expiresAt: held.expiresAt,
      status: "pending",
      notify: notifyChannels(held.notify),
    };
    this.approvals.set(record.holdId, record);
    this.queues.set(record.holdId, queue);
    this.emit(record, held);
    return record;
  }

  decide(holdId: HoldId, decision: ApprovalDecision): boolean {
    const current = this.approvals.get(holdId);
    const queue = this.queues.get(holdId);
    if (current === undefined || queue === undefined || current.status !== "pending") return false;
    const release: Release = decision.kind === "approved"
      ? { kind: "approved" }
      : { kind: "denied", by: decision.by };
    if (!queue.resolve(holdId, release)) return false;
    this.approvals.set(holdId, {
      ...current,
      status: decision.kind,
      by: decision.by,
      reason: decision.reason,
    });
    this.queues.delete(holdId);
    return true;
  }

  expire(dueAt: number): readonly ApprovalRecord[] {
    const expired: ApprovalRecord[] = [];
    for (const record of this.approvals.values()) {
      if (record.status !== "pending" || record.expiresAt > dueAt) continue;
      const queue = this.queues.get(record.holdId);
      if (queue === undefined) continue;
      this.expireOne(queue, record.holdId);
      const next = { ...record, status: "expired" as const };
      this.approvals.set(record.holdId, next);
      this.queues.delete(record.holdId);
      expired.push(next);
    }
    return expired;
  }

  get(holdId: HoldId): ApprovalRecord | undefined {
    const record = this.approvals.get(holdId);
    return record === undefined ? undefined : { ...record };
  }

  list(): readonly ApprovalRecord[] {
    return [...this.approvals.values()].map((record) => ({ ...record }));
  }

  pending(): readonly ApprovalRecord[] {
    return this.list().filter((record) => record.status === "pending");
  }

  listPending(): readonly ApprovalRecord[] {
    return this.pending();
  }

  private emit(record: ApprovalRecord, held: HeldCall): void {
    const notification: ApprovalNotification = {
      holdId: record.holdId,
      call: record.call,
      expiresAt: record.expiresAt,
      notify: record.notify,
      held,
    };
    for (const name of record.notify) this.channels[name]?.notify(notification);
  }

  private findUnregisteredHold(queue: HoldQueue, call: PolicyCall): HeldCall {
    const held = queue.list().find((candidate) => !this.approvals.has(candidate.id) && sameCall(candidate, call));
    if (held === undefined) throw new Error(`no pending hold matches ${call.tool}`);
    return held;
  }

  private expireOne(queue: HoldQueue, holdId: HoldId): void {
    const internal = queue as unknown as ExpirableQueue;
    internal.clearTimer(holdId);
    internal.finish(holdId, { kind: "expired" });
  }
}

function notifyChannels(values: readonly string[]): readonly NotifyChannel[] {
  const channels: NotifyChannel[] = [];
  for (const value of values) {
    if (value !== "cli" && value !== "slack") throw new Error(`unknown approval channel ${value}`);
    channels.push(value);
  }
  return channels;
}

function sameCall(held: HeldCall, call: PolicyCall): boolean {
  return held.tool === call.tool && held.klass === call.klass && held.blastRadius === call.blastRadius;
}
