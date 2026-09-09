import test from "node:test";
import assert from "node:assert/strict";
import { interceptCall } from "./forward/tools.ts";
import { upstreamHttp } from "./transport/http.ts";

const call = { tool: "postgres.row.delete", connector: "postgres", args: {} };
const classified = { outcome: "classified", entryId: call.tool, caseIndex: 0, tone: "r1", reason: "matched" } as const;

test("dependency failures cannot leak their messages to the agent", async () => {
  const verdict = await interceptCall(call, {
    classify: () => classified,
    policy: () => ({ kind: "allow" }),
    hold: async () => { throw new Error("unexpected hold"); },
    ledger: () => { throw new Error("synthetic-sensitive-marker"); },
  });
  assert.equal(verdict.kind, "deny");
  assert.doesNotMatch(JSON.stringify(verdict), /synthetic-sensitive-marker/);
});

test("oversized SSE lines are refused before a newline arrives", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  let finish: () => void = () => {};
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  const errors: Error[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { cancelled = true; },
  });
  const upstream = upstreamHttp(new URL("http://localhost/mcp"), {
    maxBufferSize: 16,
    fetch: async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    clock: { setTimeout() { finish(); return 0; }, clearTimeout() {} },
    events: { onMessage() { assert.fail("no message may escape"); }, onClose() {}, onError(error) { errors.push(error); } },
  });
  try {
    controller!.enqueue(new TextEncoder().encode(":" + "x".repeat(17)));
    controller!.enqueue(new TextEncoder().encode("more"));
    controller!.close();
    await completed;
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /exceeded 16 bytes/);
    assert.equal(cancelled, true);
  } finally {
    upstream.close();
  }
});

test("invalid agent blast radii cannot satisfy a small-write allow rule", async () => {
  for (const radius of [-1, Number.NaN, Number.POSITIVE_INFINITY, "0"]) {
    const verdict = await interceptCall({ ...call, args: { rows: radius } }, {
      classify: () => classified,
      policy: (input) => input.blastRadius !== undefined && input.blastRadius < 10
        ? { kind: "allow" }
        : { kind: "deny", ruleIndex: 0, rationale: "unknown radius needs review" },
      hold: async () => { throw new Error("unexpected hold"); },
      ledger() {},
    });
    assert.equal(verdict.kind, "deny");
  }
});
