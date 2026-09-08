import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { HeldCall } from "../hold.ts";
import {
  SlackChannel,
  postHoldToSlack,
  slackPayload,
} from "./slack.ts";

const call: HeldCall = {
  id: "h0001",
  tool: "postgres.row.delete",
  klass: "r1",
  blastRadius: 41883,
  ruleIndex: 4,
  rationale: "nothing matched, so the call waits for a person",
  args: {},
  heldAt: 1,
  expiresAt: 120001,
  notify: ["cli", "slack"],
};

describe("the Slack approval channel", () => {
  test("builds a payload with title, rationale and operator URLs", () => {
    const payload = slackPayload(call, (id) => `https://operator.example/holds/${id}`);
    assert.equal(payload.text, "held: postgres.row.delete (r1, 41883 touched)\nnothing matched, so the call waits for a person");
    assert.ok(JSON.stringify(payload.blocks).includes("Approve"));
    assert.ok(JSON.stringify(payload.blocks).includes("Deny"));
    assert.ok(JSON.stringify(payload.blocks).includes("https://operator.example/holds/h0001?decision=approve"));
    assert.ok(JSON.stringify(payload.blocks).includes("https://operator.example/holds/h0001?decision=deny"));
  });

  test("a disabled channel is a no-op", async () => {
    let posted = 0;
    const channel = new SlackChannel({ enabled: false }, async () => {
      posted += 1;
      return { ok: true, status: 200, text: async () => "" };
    });
    assert.deepEqual(await channel.postHold(call, () => "https://operator.example/holds/h0001"), { kind: "disabled" });
    assert.equal(posted, 0);
  });

  test("posts JSON to the webhook when enabled", async () => {
    let seenUrl = "";
    let seenBody = "";
    const result = await postHoldToSlack(
      "https://hooks.slack.test/T000/B000/secret",
      call,
      (id) => `https://operator.example/holds/${id}?source=slack`,
      async (url, init) => {
        seenUrl = url;
        seenBody = init.body;
        assert.equal(init.method, "POST");
        assert.equal(init.headers["content-type"], "application/json");
        return { ok: true, status: 200, text: async () => "ok" };
      },
    );
    assert.deepEqual(result, { kind: "posted", status: 200 });
    assert.equal(seenUrl, "https://hooks.slack.test/T000/B000/secret");
    assert.ok(seenBody.includes("held: postgres.row.delete"));
    assert.ok(seenBody.includes("decision=approve"));
    assert.ok(seenBody.includes("decision=deny"));
  });

  test("reports HTTP failures without throwing", async () => {
    const channel = new SlackChannel({ enabled: true, webhookUrl: "https://hooks.slack.test/fail" }, async () => ({
      ok: false,
      status: 500,
      text: async () => "bad webhook",
    }));
    const result = await channel.postHold(call, () => "https://operator.example/holds/h0001");
    assert.equal(result.kind, "failed");
    if (result.kind === "failed") assert.match(result.reason, /500: bad webhook/);
  });

  test("reports fetch failures and missing webhook configuration", async () => {
    const failed = new SlackChannel({ enabled: true, webhookUrl: "https://hooks.slack.test/fail" }, async () => {
      throw new Error("network down");
    });
    assert.deepEqual(await failed.postHold(call, () => "https://operator.example/holds/h0001"), {
      kind: "failed",
      reason: "network down",
    });

    const missing = new SlackChannel({ enabled: true });
    assert.deepEqual(await missing.postHold(call, () => "https://operator.example/holds/h0001"), {
      kind: "failed",
      reason: "slack webhook url is required when enabled",
    });
  });
});
