/**
 * The CLI approval channel, WP-05. Renders the hold queue to the
 * operator and turns keypresses into releases.
 *
 * The channel is deliberately dumb: it sees the queue through the same
 * list() everyone else does and it resolves through the same resolve()
 * everyone else does, so the approvals surface cannot invent policy of
 * its own. What it owns is the conversation with the human: what a held
 * call looks like on screen and which key decides it.
 */

import type { HoldQueue, HeldCall, Release } from "../hold.ts";

export type ApprovalView = {
  /** The rendered lines, ready for the terminal, no ANSI of its own. */
  readonly lines: readonly string[];
  /** The held ids in display order, so a keypress maps to a row. */
  readonly ids: readonly string[];
};

export function renderHold(call: HeldCall, index: number, now: number): string {
  const left = Math.max(0, Math.round((call.expiresAt - now) / 1000));
  const radius = call.blastRadius === undefined ? "unknown" : `${call.blastRadius}`;
  const reason = call.rationale === undefined ? "" : `: ${call.rationale}`;
  return `[${index}] ${call.id} ${call.tool} (${call.klass}, ${radius} touched) ${left}s left${reason}`;
}

/** The whole queue as one view, oldest first, because that is the order they expire. */
export function renderQueue(queue: HoldQueue, now = Date.now()): ApprovalView {
  const calls = [...queue.list()].sort((a, b) => a.heldAt - b.heldAt);
  const lines = calls.map((call, index) => renderHold(call, index, now));
  return { lines, ids: calls.map((call) => call.id) };
}

/**
 * A keypress to a release. Only the explicit keys decide: y approves, n
 * denies, everything else is a no-op that returns null, because an
 * unrecognised key must never fall through to a default decision.
 */
export function keyToRelease(key: string, by = "cli"): Release | null {
  if (key === "y") return { kind: "approved" };
  if (key === "n") return { kind: "denied", by };
  return null;
}

/**
 * Applies a keypress to a view row. Returns false when the row is gone or
 * the key decides nothing, so the caller can keep rendering without
 * special cases.
 */
export function decideKeypress(
  queue: HoldQueue,
  view: ApprovalView,
  key: string,
  row: number,
): boolean {
  const id = view.ids[row];
  if (id === undefined) return false;
  const release = keyToRelease(key);
  if (release === null) return false;
  return queue.resolve(id, release);
}
