/**
 * The blocking hold, WP-05. A held tool call blocks its MCP response until
 * a human resolves it or the timer runs out.
 *
 * The design constraint is the MCP error on cancel: if the release is a
 * generic error, the agent retries, sometimes with a slightly different
 * statement, and the tool has trained the agent to evade it. So a denied
 * release names the rule, the class, and what approval would look like,
 * in a body the model can read, and an expired hold says so plainly
 * instead of posing as a transport failure.
 */

import type { Decision } from "./index.ts";

export type HoldId = string;

/** The call that waits, everything the message to the human needs. */
export type HeldCall = {
  readonly id: HoldId;
  /** Registry entry id. */
  readonly tool: string;
  /** The reversibility class the call was given. */
  readonly klass: string;
  /** Rows, files or objects the call would touch. */
  readonly blastRadius: number | undefined;
  /** The rule index that held it, and its stated reason. */
  readonly ruleIndex: number;
  readonly rationale: string | undefined;
  /** The intercepted arguments, shown to the approver, never stored beyond this process. */
  readonly args: Readonly<Record<string, unknown>>;
  readonly heldAt: number;
  readonly expiresAt: number;
  readonly notify: readonly string[];
};

export type Release =
  | { readonly kind: "approved" }
  | { readonly kind: "denied"; readonly by: string };

export type HoldOutcome =
  | { readonly kind: "released"; readonly release: Release }
  | { readonly kind: "expired" };

export type HoldResolution = {
  readonly id: HoldId;
  readonly outcome: HoldOutcome;
  readonly call: HeldCall;
};

/**
 * The error body a blocked agent reads. It is a plain object rather than a
 * string, because the model acts on structure: the rule it broke, the
 * class it was given, and the channel where a human decides.
 */
export function holdErrorMessage(
  call: HeldCall,
  outcome: HoldOutcome,
  decision: Decision,
): { code: number; message: string; data: Record<string, unknown> } {
  const expiry = outcome.kind === "expired";
  const verb = expiry
    ? "expired without a human decision"
    : outcome.release.kind === "approved"
      ? "was approved and released"
      : "was denied by a human";
  const message =
    `The call to ${call.tool} (${call.klass}, blast radius ${call.blastRadius ?? "unknown"}) ` +
    `${verb}. Rule ${call.ruleIndex} ${decision === "hold" ? "held" : decision}ed it` +
    (call.rationale === undefined ? "." : `: ${call.rationale}.`) +
    (outcome.kind === "released" && outcome.release.kind === "denied" && !expiry
      ? ` Do not retry the same call; it was rejected by ${outcome.release.by}.`
      : "");
  return {
    code: expiry ? -32000 : -32003,
    message,
    data: {
      held: call.tool,
      class: call.klass,
      blastRadius: call.blastRadius,
      rule: call.ruleIndex,
      result: expiry ? "expired" : outcome.release.kind,
      approvedVia: call.notify,
    },
  };
}

/**
 * The pending map and its timers. One instance per proxy process, because a
 * hold is process state: a restart drops the queue, and the skeptic that
 * tests a hold outliving a restart is testing the recovery story, not this
 * class. The onExpire callback lets the proxy answer the blocked request
 * the moment the timer fires, so the agent never waits past its own
 * patience without an answer.
 */
export class HoldQueue {
  private readonly pending = new Map<HoldId, HeldCall>();
  private readonly resolvers = new Map<HoldId, (r: HoldResolution) => void>();
  private readonly timers = new Map<HoldId, ReturnType<typeof setTimeout>>();
  private seq = 0;
  private closed = false;
  private readonly onExpire: (resolution: HoldResolution) => void;

  constructor(onExpire: (resolution: HoldResolution) => void = () => {}) {
    this.onExpire = onExpire;
  }

  /**
   * Parks a call and returns the promise its MCP response waits on. The
   * timer is unref'd so a queue with nothing left cannot keep the proxy
   * process alive.
   */
  hold(
    call: Omit<HeldCall, "id" | "heldAt" | "expiresAt">,
    seconds: number,
  ): Promise<HoldResolution> {
    if (this.closed) throw new TypeError("the hold queue is closed");
    this.seq += 1;
    const id = `h${this.seq.toString(36).padStart(4, "0")}`;
    const heldAt = Date.now();
    const full: HeldCall = {
      ...call,
      id,
      heldAt,
      expiresAt: heldAt + seconds * 1000,
    };
    this.pending.set(id, full);
    const promise = new Promise<HoldResolution>((resolve) => {
      this.resolvers.set(id, resolve);
    });
    const timer = setTimeout(() => {
      this.timers.delete(id);
      const outcome: HoldOutcome = { kind: "expired" };
      this.finish(id, outcome);
      this.onExpire({ id, outcome, call: full });
    }, seconds * 1000);
    timer.unref?.();
    this.timers.set(id, timer);
    return promise;
  }

  /** A human decided. Resolving an unknown or already finished id is false, never a crash. */
  resolve(id: HoldId, release: Release, by = "cli"): boolean {
    if (!this.pending.has(id)) return false;
    this.clearTimer(id);
    this.finish(id, { kind: "released", release });
    return true;
  }

  list(): readonly HeldCall[] {
    return [...this.pending.values()].map((call) => ({ ...call }));
  }

  /** The shutdown path: everything waiting answers expired rather than hanging. */
  close(): readonly HoldResolution[] {
    this.closed = true;
    const drained: HoldResolution[] = [];
    for (const [id] of this.pending) {
      this.clearTimer(id);
      const outcome: HoldOutcome = { kind: "expired" };
      const call = this.pending.get(id)!;
      this.finish(id, outcome);
      drained.push({ id, outcome, call });
    }
    return drained;
  }

  private finish(id: HoldId, outcome: HoldOutcome): void {
    const resolve = this.resolvers.get(id);
    const call = this.pending.get(id);
    this.pending.delete(id);
    this.resolvers.delete(id);
    if (resolve !== undefined && call !== undefined) resolve({ id, outcome, call });
  }

  private clearTimer(id: HoldId): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }
}
