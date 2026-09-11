import test from "node:test";
import assert from "node:assert/strict";
import { primeArguments, primeEvent } from "./prime-bridge.mjs";
test("prime bridge passes prompts as data and forwards only selected event fields", () => {
  const job = {
    id: "01234567-0123-0123-0123-012345678901",
    generation: 1,
    prompt: "--api-key stolen",
    provider: "opencode",
    model: "safe-model",
  };
  const args = primeArguments(job, "/tmp/session", "/tmp/work");
  assert.deepEqual(args.slice(-2), ["--", job.prompt]);
  assert.throws(() =>
    primeArguments({ ...job, provider: "--help" }, "/tmp", "/tmp"),
  );
  assert.throws(() =>
    primeArguments({ ...job, id: "../../escape" }, "/tmp", "/tmp"),
  );
  assert.equal(
    primeEvent({ type: "tool_execution_end", result: "secret" }),
    undefined,
  );
  assert.deepEqual(
    primeEvent({
      type: "tool_execution_start",
      toolName: "read",
      args: { key: "secret" },
    }),
    { type: "tool", name: "read" },
  );
  assert.deepEqual(
    primeEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    }),
    { type: "answer", text: "Done", failed: false, error: undefined },
  );
});
