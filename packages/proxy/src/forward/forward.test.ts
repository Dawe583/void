import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { forwardPromptMessage, relayPromptNotification } from "./prompts.ts";
import { forwardResourceMessage, relayResourceNotification } from "./resources.ts";

const resourceRequest = { jsonrpc: "2.0", id: 1, method: "resources/list", params: { cursor: "a" } } as const;
const promptRequest = { jsonrpc: "2.0", id: "p1", method: "prompts/get", params: { name: "deploy" } } as const;

describe("read-only forwarders", () => {
  test("passes resources and prompts requests through unchanged", async () => {
    assert.equal(await forwardResourceMessage(resourceRequest, async (message) => message), resourceRequest);
    assert.equal(await forwardPromptMessage(promptRequest, async (message) => message), promptRequest);
  });

  test("relays list_changed notifications verbatim", () => {
    const resources = { jsonrpc: "2.0", method: "notifications/resources/list_changed" } as const;
    const prompts = { jsonrpc: "2.0", method: "notifications/prompts/list_changed" } as const;

    assert.equal(relayResourceNotification(resources), resources);
    assert.equal(relayPromptNotification(prompts), prompts);
  });

  test("rejects malformed resource and prompt framing", async () => {
    await assert.rejects(
      () => forwardResourceMessage({ jsonrpc: "2.0", method: "resources/list", params: [] }, async (message) => message),
      /id is required/,
    );
    await assert.rejects(
      () => forwardPromptMessage({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: {} }, async (message) => message),
      /params.name/,
    );
    assert.throws(
      () => relayResourceNotification({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" }),
      /resource notification/,
    );
  });
});
