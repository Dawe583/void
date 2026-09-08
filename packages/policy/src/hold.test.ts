import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  HoldQueue,
  holdErrorMessage,
  type HeldCall,
  type HoldOutcome,
} from "./hold.ts";

const baseCall = {
  tool: "postgres.row.delete",
  klass: "r1",
  blastRadius: 41883,
  ruleIndex: 2,
  rationale: "the damage is visible, so a human looks first",
  args: { table: "orders", where: "status = shipped" },
  notify: ["cli"],
};

const held = (over: Partial<HeldCall> = {}): HeldCall => ({
  id: "h0001",
  heldAt: 1,
  expiresAt: 120001,
  ...baseCall,
  ...over,
});

describe("holdErrorMessage, the body the model reads", () => {
  test("a denial names the tool, the class, the rule and the retry prohibition", () => {
    const outcome: HoldOutcome = { kind: "released", release: { kind: "denied", by: "cli" } };
    const body = holdErrorMessage(held(), outcome, "hold");
    assert.ok(body.message.includes("postgres.row.delete"));
    assert.ok(body.message.includes("r1"));
    assert.ok(body.message.includes("41883"));
    assert.ok(body.message.includes("Do not retry"));
    assert.equal(body.data.result, "denied");
  });

  test("an expiry is honest about being a timeout, never a transport error", () => {
    const body = holdErrorMessage(held(), { kind: "expired" }, "hold");
    assert.ok(body.message.includes("expired without a human decision"));
    assert.ok(!body.message.includes("Do not retry"));
    assert.equal(body.data.result, "expired");
  });

  test("an approval says so, because the model should stop hedging", () => {
    const body = holdErrorMessage(
      held(),
      { kind: "released", release: { kind: "approved" } },
      "hold",
    );
    assert.ok(body.message.includes("approved and released"));
    assert.equal(body.data.result, "approved");
  });
});

describe("HoldQueue, the pending map and its timers", () => {
  test("a resolved hold answers with the release", async () => {
    const queue = new HoldQueue();
    const waiting = queue.hold(baseCall, 120);
    assert.equal(queue.list().length, 1);
    assert.equal(queue.resolve("h0001", { kind: "approved" }), true);
    const resolution = await waiting;
    assert.equal(resolution.outcome.kind, "released");
    if (resolution.outcome.kind === "released")
      assert.equal(resolution.outcome.release.kind, "approved");
    assert.equal(queue.list().length, 0);
    queue.close();
  });

  test("an expired hold answers the moment the timer fires", async () => {
    let fired = 0;
    const queue = new HoldQueue(() => {
      fired += 1;
    });
    const waiting = queue.hold(baseCall, 0.02);
    const resolution = await waiting;
    assert.equal(resolution.outcome.kind, "expired");
    assert.equal(fired, 1);
    queue.close();
  });

  test("resolving an unknown id is false, not a crash", () => {
    const queue = new HoldQueue();
    assert.equal(queue.resolve("nope", { kind: "approved" }), false);
    queue.close();
  });

  test("close drains everything as expired, a restart drops the queue", async () => {
    const queue = new HoldQueue();
    const waiting = queue.hold(baseCall, 300);
    const drained = queue.close();
    assert.equal(drained.length, 1);
    const resolution = await waiting;
    assert.equal(resolution.outcome.kind, "expired");
  });

  test("a second hold after close is refused loudly", () => {
    const queue = new HoldQueue();
    queue.close();
    assert.throws(() => queue.hold(baseCall, 10), /closed/);
  });

  test("holds resolve out of order without cross talk", async () => {
    const queue = new HoldQueue();
    const first = queue.hold({ ...baseCall, tool: "a" }, 120);
    const second = queue.hold({ ...baseCall, tool: "b" }, 120);
    assert.equal(queue.list().length, 2);
    queue.resolve("h0002", { kind: "denied", by: "slack" });
    const secondResolution = await second;
    assert.equal(secondResolution.call.tool, "b");
    queue.resolve("h0001", { kind: "approved" });
    const firstResolution = await first;
    assert.equal(firstResolution.call.tool, "a");
    assert.equal(firstResolution.outcome.kind, "released");
    queue.close();
  });
});
