import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { RegistryTone } from "../../../registry/src/index.ts";
import { interceptCall, type InterceptedCall, type JsonRpcError } from "./tools.ts";

const call: InterceptedCall = {
  tool: "postgres.query",
  connector: "postgres",
  args: { rows: 12, sql: "delete from secret_table" },
};

function classified(klass: RegistryTone = "r1") {
  return { outcome: "classified", entryId: call.tool, caseIndex: 0, tone: klass, reason: "matched" } as const;
}

describe("interceptCall", () => {
  test("allows a classified call and records decision plus resolution", async () => {
    const ledger: unknown[] = [];
    const verdict = await interceptCall(call, {
      classify: () => classified("r0"),
      policy: (policyCall) => {
        assert.equal(policyCall.klass, "r0");
        assert.equal(policyCall.blastRadius, 12);
        return { kind: "allow" };
      },
      hold: async () => { throw new Error("hold should not run"); },
      ledger: (entry) => ledger.push(entry),
    });

    assert.deepEqual(verdict, { kind: "allow" });
    assert.equal(ledger.length, 2);
    assert.deepEqual(ledger.map((entry) => (entry as { decision: string }).decision), ["allow", "allow:resolved"]);
  });

  test("denies with a readable application error that names the call", async () => {
    const verdict = await interceptCall(call, {
      classify: () => classified("r3"),
      policy: () => ({ kind: "deny", ruleIndex: 4, rationale: "production writes need review" }),
      hold: async () => { throw new Error("hold should not run"); },
      ledger: () => {},
    });

    assert.equal(verdict.kind, "deny");
    const error = (verdict as { error: JsonRpcError }).error;
    assert.equal(error.error.code, -32003);
    assert.match(error.error.message, /postgres\.query/);
    assert.match(error.error.message, /r3/);
    assert.match(error.error.message, /blast radius 12/);
    assert.match(error.error.message, /Rule 4/);
    assert.match(error.error.message, /production writes need review/);
    assert.match(error.error.message, /Do not retry/);
    const data = error.error.data as Record<string, unknown>;
    assert.equal(data.tool, "postgres.query");
    assert.equal(data.class, "r3");
    assert.equal(data.blastRadius, 12);
    assert.equal(data.rule, 4);
  });

  test("maps approved holds to a placeholder result and records resolution", async () => {
    const ledger: unknown[] = [];
    const verdict = await interceptCall(call, {
      classify: () => classified("r2"),
      policy: () => ({ kind: "hold", ruleIndex: 2, seconds: 30, notify: ["cli"], rationale: "needs a human" }),
      hold: async (seconds) => ({
        id: "h1",
        outcome: { kind: "released", release: { kind: "approved" } },
        call: { id: "h1", tool: call.tool, klass: "r2", blastRadius: 12, ruleIndex: 2, rationale: "needs a human", args: call.args, heldAt: 1, expiresAt: 1 + seconds * 1000, notify: ["cli"] },
      }),
      ledger: (entry) => ledger.push(entry),
    });

    assert.equal(verdict.kind, "hold");
    const result = await (verdict as { promise: Promise<unknown> }).promise;
    assert.deepEqual(result, { jsonrpc: "2.0", id: 0, result: { approved: true } });
    assert.deepEqual(ledger.map((entry) => (entry as { decision: string }).decision), ["hold", "hold:approved"]);
  });

  test("maps denied and expired holds to readable errors", async () => {
    for (const outcome of [
      { kind: "released", release: { kind: "denied", by: "alice" } },
      { kind: "expired" },
    ] as const) {
      const verdict = await interceptCall(call, {
        classify: () => classified("r2"),
        policy: () => ({ kind: "hold", ruleIndex: 2, seconds: 30, notify: ["cli"], rationale: "needs a human" }),
        hold: async () => ({
          id: "h1",
          outcome,
          call: { id: "h1", tool: call.tool, klass: "r2", blastRadius: 12, ruleIndex: 2, rationale: "needs a human", args: call.args, heldAt: 1, expiresAt: 2, notify: ["cli"] },
        }),
        ledger: () => {},
      });
      const error = await (verdict as { promise: Promise<JsonRpcError> }).promise;
      assert.equal(error.error.code, -32003);
      assert.match(error.error.message, /postgres\.query/);
      assert.match(error.error.message, /r2/);
      assert.match(error.error.message, /Do not retry/);
    }
  });

  test("classifies an unknown tool as r3", async () => {
    let seenClass = "";
    const verdict = await interceptCall(call, {
      classify: () => ({ outcome: "unknown-tool", entryId: call.tool }),
      policy: (policyCall) => {
        seenClass = policyCall.klass;
        return { kind: "deny", ruleIndex: 0, rationale: "unknown" };
      },
      hold: async () => { throw new Error("hold should not run"); },
      ledger: () => {},
    });

    assert.equal(verdict.kind, "deny");
    assert.equal(seenClass, "r3");
  });

  test("records a digest instead of the argument payload", async () => {
    const ledger: unknown[] = [];
    await interceptCall(call, {
      classify: () => classified("r3"),
      policy: () => ({ kind: "deny", ruleIndex: 0, rationale: "no" }),
      hold: async () => { throw new Error("hold should not run"); },
      ledger: (entry) => ledger.push(entry),
    });

    const stored = JSON.stringify(ledger);
    assert.match(stored, /[0-9a-f]{64}/);
    assert.doesNotMatch(stored, /secret_table/);
  });
});
