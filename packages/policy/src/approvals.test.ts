import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { ApprovalBroker, type ApprovalNotification } from "./approvals.ts";
import { HoldQueue, holdErrorMessage } from "./hold.ts";
import type { PolicyCall } from "./decide.ts";

describe("ApprovalBroker", () => {
  test("register records the pending hold and notifies the configured channel", () => {
    const notifications: ApprovalNotification[] = [];
    const queue = new HoldQueue();
    const call = policyCall();
    void queue.hold(heldCall(), 60);
    const broker = new ApprovalBroker({
      channels: {
        cli: { notify(approval) { notifications.push(approval); } },
      },
    });

    const record = broker.register(queue, call);

    assert.equal(record.holdId, "h0001");
    assert.equal(record.status, "pending");
    assert.equal(record.call.tool, call.tool);
    assert.deepEqual(record.notify, ["cli"]);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.holdId, record.holdId);
  });

  test("decide routes approval to the hold queue", async () => {
    const queue = new HoldQueue();
    const promise = queue.hold(heldCall(), 60);
    const broker = new ApprovalBroker();
    const record = broker.register(queue, policyCall());

    assert.equal(broker.decide(record.holdId, { kind: "approved", by: "ada" }), true);
    const resolution = await promise;

    assert.equal(resolution.outcome.kind, "released");
    assert.deepEqual(resolution.outcome, { kind: "released", release: { kind: "approved" } });
    assert.equal(broker.get(record.holdId)?.status, "approved");
    assert.equal(broker.get(record.holdId)?.by, "ada");
  });

  test("decide routes denial to the hold queue", async () => {
    const queue = new HoldQueue();
    const promise = queue.hold(heldCall(), 60);
    const broker = new ApprovalBroker();
    const record = broker.register(queue, policyCall());

    assert.equal(broker.decide(record.holdId, { kind: "denied", by: "bea", reason: "too broad" }), true);
    const resolution = await promise;

    assert.equal(resolution.outcome.kind, "released");
    assert.deepEqual(resolution.outcome, { kind: "released", release: { kind: "denied", by: "bea" } });
    assert.equal(broker.get(record.holdId)?.status, "denied");
    assert.equal(broker.get(record.holdId)?.reason, "too broad");
  });

  test("expire resolves due holds as expired without sleeping", async () => {
    const queue = new HoldQueue();
    const promise = queue.hold(heldCall(), 60);
    const broker = new ApprovalBroker();
    const record = broker.register(queue, policyCall());

    const expired = broker.expire(record.expiresAt);
    const resolution = await promise;

    assert.equal(expired.length, 1);
    assert.equal(expired[0]?.status, "expired");
    assert.equal(resolution.outcome.kind, "expired");
    assert.equal(broker.get(record.holdId)?.status, "expired");
  });

  test("denied approvals produce the readable hold error", async () => {
    const queue = new HoldQueue();
    const promise = queue.hold(heldCall(), 60);
    const broker = new ApprovalBroker();
    const record = broker.register(queue, policyCall());

    broker.decide(record.holdId, { kind: "denied", by: "casey" });
    const resolution = await promise;
    const body = holdErrorMessage(resolution.call, resolution.outcome, "hold");

    assert.match(body.message, /was denied by a human/);
    assert.match(body.message, /Do not retry the same call/);
    assert.equal(body.data.result, "denied");
  });
});

function policyCall(): PolicyCall {
  return {
    tool: "aws.s3.bucket.delete",
    connector: "aws",
    workspace: "test",
    klass: "r3",
    blastRadius: 3,
  };
}

function heldCall(): Parameters<HoldQueue["hold"]>[0] {
  return {
    tool: "aws.s3.bucket.delete",
    klass: "r3",
    blastRadius: 3,
    ruleIndex: 0,
    rationale: "approval required",
    args: { n: 3 },
    notify: ["cli"],
  };
}
