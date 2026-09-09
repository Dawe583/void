/**
 * Approval state stays outside HoldQueue so HTTP, Slack and the terminal
 * cannot learn different decision rules. The broker has no timers by design:
 * the proxy or API server pumps expire(), which keeps tests deterministic and
 * makes a stalled event loop fail closed through the original hold timeout.
 */

import * as nodeFs from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

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
  readonly decisionToken?: string;
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
  readonly stateDir?: string;
  readonly fs?: ApprovalFs;
  readonly nonce?: () => string;
  readonly now?: () => number;
};

type ExpirableQueue = {
  readonly clearTimer: (id: HoldId) => void;
  readonly finish: (id: HoldId, outcome: HoldResolution["outcome"]) => void;
};

export class ApprovalBroker {
  private readonly approvals = new Map<HoldId, ApprovalRecord>();
  private readonly queues = new Map<HoldId, HoldQueue>();
  private readonly channels: Partial<Record<NotifyChannel, ApprovalChannel>>;

  readonly stateDirectory: string | undefined;
  readonly fs: ApprovalFs;
  private readonly nonce: () => string;
  private readonly now: () => number;
  private lockHeld = false;

  constructor(options: ApprovalBrokerOptions = {}) {
    this.channels = options.channels ?? {};
    this.stateDirectory = options.stateDir;
    this.fs = options.fs ?? nodeFs;
    this.nonce = options.nonce ?? randomUUID;
    this.now = options.now ?? Date.now;
    if (this.stateDirectory !== undefined) {
      secureDirectory(this.stateDirectory, this.fs);
      const lockPath = join(this.stateDirectory, "proxy.lock");
      let fd: number;
      try { fd = this.fs.openSync(lockPath, "wx", 0o600); }
      catch (error) {
        if (isObject(error) && error.code === "EEXIST") throw new ApprovalStateInUseError();
        throw error;
      }
      this.lockHeld = true;
      try {
        try {
          this.fs.writeFileSync(fd, String(process.pid));
          this.fs.fsyncSync(fd);
        } finally { this.fs.closeSync(fd); }
        secureDirectory(join(this.stateDirectory, "decisions"), this.fs);
        this.savePending(this.stateDirectory);
      } catch (error) {
        this.close();
        throw error;
      }
    }
  }

  register(queue: HoldQueue, call: PolicyCall): ApprovalRecord {
    const held = this.findUnregisteredHold(queue, call);
    const record: ApprovalRecord = {
      holdId: held.id,
      decisionToken: this.nonce(),
      call,
      expiresAt: held.expiresAt,
      status: "pending",
      notify: notifyChannels(held.notify),
    };
    this.approvals.set(record.holdId, record);
    this.queues.set(record.holdId, queue);
    try {
      this.flush();
      this.emit(record, held);
    } catch (error) {
      queue.resolve(record.holdId, { kind: "denied", by: "approval state failure" });
      throw error;
    }
    return record;
  }

  decide(holdId: HoldId, decision: ApprovalDecision): boolean {
    validateDecision(decision);
    this.expire(this.now());
    const current = this.approvals.get(holdId);
    const queue = this.queues.get(holdId);
    if (current === undefined || queue === undefined || current.status !== "pending") return false;
    const release: Release = decision.kind === "approved"
      ? { kind: "approved" }
      : { kind: "denied", by: decision.by };
    if (this.stateDirectory !== undefined) {
      savePending(this.stateDirectory, this.pending().filter((record) => record.holdId !== holdId), this.fs);
    }
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
      if (record.status !== "pending") continue;
      const queue = this.queues.get(record.holdId);
      if (queue === undefined) continue;
      if (record.expiresAt > dueAt && queue.list().some((held) => held.id === record.holdId)) continue;
      this.expireOne(queue, record.holdId);
      const next = { ...record, status: "expired" as const };
      this.approvals.set(record.holdId, next);
      this.queues.delete(record.holdId);
      expired.push(next);
    }
    if (expired.length > 0) this.flush();
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

  close(): void {
    if (!this.lockHeld || this.stateDirectory === undefined) return;
    this.fs.unlinkSync(join(this.stateDirectory, "proxy.lock"));
    this.lockHeld = false;
  }

  savePending(dir: string): void {
    savePending(dir, this.pending(), this.fs);
  }

  consumeDecisions(): void {
    const dir = this.stateDirectory;
    if (dir === undefined) return;
    assertPrivateDirectory(dir, this.fs);
    assertPrivateDirectory(join(dir, "decisions"), this.fs);
    for (const name of this.fs.readdirSync(join(dir, "decisions"))) {
      if (!name.endsWith(".json")) continue;
      const path = join(dir, "decisions", name);
      try {
        assertPrivateFile(path, this.fs);
        const value: unknown = JSON.parse(this.fs.readFileSync(path, "utf8"));
        if (!isObject(value) || typeof value.holdId !== "string" || typeof value.decisionToken !== "string") {
          throw new Error("invalid approval decision file");
        }
        validateDecision(value.decision);
        const record = this.get(value.holdId);
        if (record?.decisionToken === value.decisionToken) this.decide(value.holdId, value.decision);
      } finally {
        this.fs.unlinkSync(path);
      }
    }
  }

  private flush(): void {
    if (this.stateDirectory !== undefined) this.savePending(this.stateDirectory);
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

/**
 * Local owner-only files avoid a new network listener. One proxy owns a state
 * directory, enforced by an exclusive lock. After a crash an operator must
 * confirm the old process is gone before removing proxy.lock; guessing from a
 * reused PID could admit two writers. Nonces bind decisions to this hold, because queue ids repeat after
 * restart. A crash leaves only complete files or ignored temporary files; it
 * never restores a held call. Payload arguments are not part of ApprovalRecord.
 */
export type ApprovalFs = Pick<typeof nodeFs,
  "mkdirSync" | "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" |
  "renameSync" | "unlinkSync" | "readFileSync" | "readdirSync" | "lstatSync">;

export function savePending(dir: string, records: readonly ApprovalRecord[], fs: ApprovalFs = nodeFs): void {
  atomicWrite(dir, "pending.json", records, fs);
}

export function loadPending(dir: string, fs: ApprovalFs = nodeFs): readonly ApprovalRecord[] {
  assertPrivateDirectory(dir, fs);
  assertPrivateFile(join(dir, "pending.json"), fs);
  const value: unknown = JSON.parse(fs.readFileSync(join(dir, "pending.json"), "utf8"));
  if (!Array.isArray(value) || !value.every((item: unknown) => isObject(item) &&
    typeof item.holdId === "string" && typeof item.decisionToken === "string" &&
    item.status === "pending" && typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt) &&
    isObject(item.call) && typeof item.call.tool === "string" && typeof item.call.klass === "string" &&
    Array.isArray(item.notify))) throw new Error("invalid pending approvals file");
  return value as ApprovalRecord[];
}

export function writeDecision(
  dir: string, holdId: string, decision: ApprovalDecision, fs: ApprovalFs = nodeFs,
  now: () => number = Date.now,
): void {
  validateDecision(decision);
  const record = loadPending(dir, fs).find((pending) => pending.holdId === holdId);
  if (record === undefined || record.expiresAt <= now()) throw new Error("hold is not pending or has expired");
  atomicWrite(join(dir, "decisions"), `${randomUUID()}.json`, {
    holdId, decisionToken: record.decisionToken, decision,
  }, fs);
}

function atomicWrite(dir: string, name: string, value: unknown, fs: ApprovalFs): void {
  secureDirectory(dir, fs);
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, join(dir, name));
    const directory = fs.openSync(dir, "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* Rename may already have committed. */ }
    throw error;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDecision(value: unknown): asserts value is ApprovalDecision {
  if (!isObject(value) || (value.kind !== "approved" && value.kind !== "denied") ||
    typeof value.by !== "string" || value.by.trim() === "" ||
    (value.reason !== undefined && typeof value.reason !== "string") ||
    Object.keys(value).some((key) => !["kind", "by", "reason"].includes(key))) {
    throw new Error("invalid approval decision");
  }
}

function secureDirectory(dir: string, fs: ApprovalFs): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(dir, fs);
}

function assertPrivateDirectory(dir: string, fs: ApprovalFs): void {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error("approval state requires an owner-only directory without symlinks");
  }
}

function assertPrivateFile(path: string, fs: ApprovalFs): void {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024 ||
    (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error("approval state requires a bounded owner-only regular file");
  }
}

export class ApprovalStateInUseError extends Error {
  readonly code = "APPROVAL_STATE_IN_USE";
  constructor() {
    super("approval state directory is locked; stop its proxy, or confirm it has exited before removing proxy.lock");
    this.name = "ApprovalStateInUseError";
  }
}
