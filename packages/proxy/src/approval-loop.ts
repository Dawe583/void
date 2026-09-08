/**
 * The proxy owns pumping because approval expiry is part of request routing,
 * not policy. There are no timers here: callers invoke poll() between input
 * reads so approval tests can move time without sleeping.
 */

import type { ApprovalBroker, ApprovalRecord } from "../../policy/src/approvals.ts";
import type { HeldCall, HoldQueue } from "../../policy/src/hold.ts";
import type { PolicyCall } from "../../policy/src/decide.ts";

export type ApprovalClock = {
  readonly now: () => number;
};

export type ApprovalPump = {
  readonly onHold: (queue: HoldQueue) => void;
  readonly poll: (dueAt?: number) => readonly ApprovalRecord[];
  readonly stop: () => void;
};

export function pumpApprovals(
  broker: ApprovalBroker,
  clock: ApprovalClock = { now: () => Date.now() },
): ApprovalPump {
  let active: { readonly queue: HoldQueue; readonly originalHold: HoldQueue["hold"] } | null = null;

  return {
    onHold(queue) {
      const originalHold = queue.hold.bind(queue);
      queue.hold = ((call: Omit<HeldCall, "id" | "heldAt" | "expiresAt">, seconds: number) => {
        const promise = originalHold(call, seconds);
        const held = newestHold(queue, call.tool);
        broker.register(queue, policyCallFromHeld(held));
        return promise;
      }) as HoldQueue["hold"];
      active = { queue, originalHold };
    },
    poll(dueAt = clock.now()) {
      return broker.expire(dueAt);
    },
    stop() {
      if (active === null) return;
      active.queue.hold = active.originalHold;
      active = null;
    },
  };
}

function newestHold(queue: HoldQueue, tool: string): HeldCall {
  const matches = queue.list().filter((call) => call.tool === tool);
  const latest = matches.at(-1);
  if (latest === undefined) throw new Error(`hold queue did not retain ${tool}`);
  return latest;
}

function policyCallFromHeld(held: HeldCall): PolicyCall {
  return {
    tool: held.tool,
    connector: connectorFromTool(held.tool),
    workspace: undefined,
    klass: held.klass,
    blastRadius: held.blastRadius,
  };
}

function connectorFromTool(tool: string): string {
  const dot = tool.indexOf(".");
  return dot === -1 ? tool : tool.slice(0, dot);
}
