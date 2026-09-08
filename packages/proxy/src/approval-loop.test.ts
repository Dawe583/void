import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApprovalBroker } from "../../policy/src/approvals.ts";
import { pumpApprovals } from "./approval-loop.ts";
import { runProxy } from "./bin.ts";
import type { ProxyOptions, UpstreamEvents } from "./bin.ts";
import type { HoldQueue } from "../../policy/src/hold.ts";
import type { UpstreamProcess } from "./transport/stdio.ts";

describe("pumpApprovals", () => {
  test("approved hold releases and forwards the call", async () => {
    const { broker, notified } = brokerWithNotification();
    const harness = await makeHarness("hold", broker);
    queueMicrotask(async () => {
      const approval = await notified;
      broker.decide(approval.holdId, { kind: "approved", by: "ops" });
    });

    await harness.run([toolCall(31, "aws.s3.bucket.delete")]);

    assert.equal(harness.upstreamMessages.length, 1);
    assert.deepEqual(harness.outputMessages, [
      { jsonrpc: "2.0", id: 31, result: { called: "aws.s3.bucket.delete" } },
    ]);
  });

  test("denied hold returns the readable hold error", async () => {
    const { broker, notified } = brokerWithNotification();
    const harness = await makeHarness("hold", broker);
    queueMicrotask(async () => {
      const approval = await notified;
      broker.decide(approval.holdId, { kind: "denied", by: "ops", reason: "too broad" });
    });

    await harness.run([toolCall(32, "aws.s3.bucket.delete")]);

    assert.deepEqual(harness.upstreamMessages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string; readonly data: { readonly result: string } } };
    assert.equal(error.id, 32);
    assert.match(error.error.message, /was denied by a human/);
    assert.match(error.error.message, /Do not retry/);
    assert.equal(error.error.data.result, "denied");
  });

  test("poll drains expired approvals through the hold queue", async () => {
    const { broker, notified } = brokerWithNotification();
    const harness = await makeHarness("hold", broker);
    let pump: ReturnType<typeof pumpApprovals> | null = null;
    harness.onPump = (created) => { pump = created; };
    queueMicrotask(async () => {
      const approval = await notified;
      pump?.poll(approval.expiresAt);
    });

    await harness.run([toolCall(33, "aws.s3.bucket.delete")]);

    assert.deepEqual(harness.upstreamMessages, []);
    const error = harness.outputMessages[0] as { readonly id: number; readonly error: { readonly message: string; readonly data: { readonly result: string } } };
    assert.equal(error.id, 33);
    assert.match(error.error.message, /expired without a human decision/);
    assert.equal(error.error.data.result, "expired");
  });
});

type Decision = "hold";
type Harness = {
  readonly upstreamMessages: Array<Record<string, unknown>>;
  readonly outputMessages: unknown[];
  readonly errors: string[];
  onPump?: (pump: ReturnType<typeof pumpApprovals>) => void;
  readonly run: (messages: readonly Record<string, unknown>[]) => Promise<void>;
};

async function makeHarness(decision: Decision, broker: ApprovalBroker, posture: ProxyOptions["posture"] = "fail-closed"): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "void-approval-loop-"));
  const policyPath = join(dir, "policy.yml");
  await writeFile(policyPath, policyText(decision));
  const upstreamMessages: Array<Record<string, unknown>> = [];
  const outputMessages: unknown[] = [];
  const errors: string[] = [];

  const harness: Harness = {
    upstreamMessages,
    outputMessages,
    errors,
    async run(messages) {
      await runProxy({
        upstreamCommand: ["fake"],
        policyPath,
        posture,
        ledgerDir: await mkdtemp(join(tmpdir(), "void-approval-ledger-")),
        workspace: "test",
        input: fromLines(messages.map((message) => JSON.stringify(message))),
        output(line) { outputMessages.push(JSON.parse(line) as unknown); },
        error(line) { errors.push(line); },
        onHold(queue) {
          const pump = pumpApprovals(broker);
          pump.onHold(queue);
          harness.onPump?.(pump);
        },
        upstreamSpawn(events) {
          return fakeUpstream(events, upstreamMessages);
        },
      });
    },
  };
  return harness;
}

function fakeUpstream(events: UpstreamEvents, seen: Array<Record<string, unknown>>): UpstreamProcess {
  return {
    send(line) {
      const message = JSON.parse(line) as { readonly id?: number; readonly method?: string; readonly params?: { readonly name?: string } };
      seen.push(message as Record<string, unknown>);
      if (message.method === "tools/call") {
        events.onMessage(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { called: message.params?.name } }));
      }
    },
    close() {},
    onStderr() { return () => {}; },
  };
}

async function* fromLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

function policyText(decision: Decision): string {
  void decision;
  return `version: 1
rules:
  - match: {}
    decision: hold
    seconds: 60
    notify: [cli]
    rationale: tests hold r3
`;
}

function toolCall(id: number, name: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { n: 3 } } };
}

type NotifiedApproval = Awaited<ReturnType<ApprovalBroker["pending"]>>[number];

function brokerWithNotification(): { readonly broker: ApprovalBroker; readonly notified: Promise<NotifiedApproval> } {
  let resolveNotification: (approval: NotifiedApproval) => void = () => {};
  const notified = new Promise<NotifiedApproval>((resolve) => { resolveNotification = resolve; });
  const broker = new ApprovalBroker({
    channels: {
      cli: {
        notify(approval) {
          resolveNotification({
            holdId: approval.holdId,
            call: approval.call,
            expiresAt: approval.expiresAt,
            status: "pending",
            notify: approval.notify,
          });
        },
      },
    },
  });
  return { broker, notified };
}
