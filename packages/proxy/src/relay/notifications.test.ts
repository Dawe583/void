import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { relayNotification } from "./notifications.ts";
import type { JsonRpcNotification, NotificationRelaySession } from "./notifications.ts";

const notificationKinds: readonly JsonRpcNotification[] = [
  { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 201, reason: "operator" } },
  { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: 201, progress: 1, total: 3, message: "working" } },
  { jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: { trace: "agent" } } },
  { jsonrpc: "2.0", method: "notifications/roots/list_changed", params: { _meta: { trace: "roots" } } },
  { jsonrpc: "2.0", method: "notifications/message", params: { level: "info", logger: "demo", data: { ok: true } } },
  { jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "file:///tmp/a" } },
  { jsonrpc: "2.0", method: "notifications/resources/list_changed", params: { _meta: { trace: "resources" } } },
  { jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: { trace: "tools" } } },
  { jsonrpc: "2.0", method: "notifications/prompts/list_changed", params: { _meta: { trace: "prompts" } } },
  {
    jsonrpc: "2.0",
    method: "notifications/tasks/status",
    params: {
      taskId: "task-1",
      status: "working",
      ttl: null,
      createdAt: "2026-09-04T00:00:00.000Z",
      lastUpdatedAt: "2026-09-04T00:00:01.000Z",
    },
  },
  { jsonrpc: "2.0", method: "notifications/elicitation/complete", params: { elicitationId: "elicit-1" } },
];

describe("relayNotification", () => {
  test("relays every WP-01 notification kind", () => {
    const session: NotificationRelaySession = { agentToUpstream: new Map([[101, 201]]) };

    const relayed = notificationKinds.map((notification) => relayNotification(notification, session));

    assert.equal(relayed.length, notificationKinds.length);
    for (const result of relayed) {
      assert.equal(result.forwarded, true);
      assert.equal(result.notification.jsonrpc, "2.0");
    }
    assert.deepEqual(relayed[0]?.notification.params, { requestId: 101, reason: "operator" });
    assert.deepEqual(relayed[1]?.notification.params, { progressToken: 101, progress: 1, total: 3, message: "working" });
    assert.deepEqual(relayed.slice(2).map((entry) => entry.notification), notificationKinds.slice(2));
  });

  test("translates a progress token in meta without mutating input", () => {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { _meta: { progressToken: "up-9", other: true }, progress: 2 },
    };
    const session: NotificationRelaySession = { progressTokenToAgent: new Map([["up-9", "agent-3"]]) };

    const result = relayNotification(notification, session);

    assert.deepEqual(result.notification.params, { _meta: { progressToken: "agent-3", other: true }, progress: 2 });
    assert.deepEqual(notification.params, { _meta: { progressToken: "up-9", other: true }, progress: 2 });
    assert.notEqual(result.notification, notification);
    assert.notEqual(result.notification.params, notification.params);
  });

  test("unknown progress token still forwards and reports the miss", () => {
    const missed: Array<string | number> = [];
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progressToken: 999, progress: 1 },
    };

    const result = relayNotification(notification, { onUnknownProgressToken: (token) => missed.push(token) });

    assert.equal(result.forwarded, true);
    assert.deepEqual(result.notification, notification);
    assert.notEqual(result.notification, notification);
    assert.deepEqual(missed, [999]);
  });

  test("cancelled translates server request ids", () => {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 77, reason: "server stopped" },
    };

    const result = relayNotification(notification, { upstreamToAgent: new Map([[77, 6]]) });

    assert.deepEqual(result.notification.params, { requestId: 6, reason: "server stopped" });
    assert.deepEqual(notification.params, { requestId: 77, reason: "server stopped" });
  });
});
