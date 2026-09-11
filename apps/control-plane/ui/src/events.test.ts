import { test } from "node:test";
import assert from "node:assert/strict";
import { transcriptEvents } from "./events.ts";
test("stream fragments render once and reconcile with authoritative completion", () => {
  const deltas = [
    { seq: 1, type: "message.delta", payload: { text: "Hello " }, at: "a" },
    { seq: 2, type: "message.delta", payload: { text: "world" }, at: "b" },
  ];
  assert.equal(transcriptEvents(deltas)[0].text, "Hello world");
  const final = {
    seq: 3,
    type: "message.completed",
    kind: "assistant",
    text: "Hello world!",
    at: "c",
  };
  assert.deepEqual(transcriptEvents([...deltas, final]), [final]);
  assert.deepEqual(
    transcriptEvents([{ type: "run.status" }, { type: "usage.reported" }]),
    [],
  );
});
test("tool start and result share one card without losing arguments", () => {
  const events = transcriptEvents([
    {
      id: "start",
      seq: 1,
      type: "tool.started",
      kind: "tool",
      payload: { callId: "a", tool: "write", arguments: { path: "plan.md" } },
    },
    {
      id: "end",
      seq: 2,
      type: "tool.result",
      kind: "tool",
      payload: { callId: "a", result: { isError: false, content: [] } },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "start");
  assert.equal(events[0].payload.status, "completed");
  assert.deepEqual(events[0].payload.arguments, { path: "plan.md" });
});
