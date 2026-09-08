import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { RegistryTone } from "../../../registry/src/index.ts";
import { probeDispatcher, type ConnectorProbe, type ProbeCache } from "../blast.ts";
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
      ledger: (entry) => { ledger.push(entry); },
    });

    assert.deepEqual(verdict, { kind: "allow" });
    assert.equal(ledger.length, 2);
    assert.deepEqual(ledger.map((entry) => (entry as { decision: string }).decision), ["allow", "allow:resolved"]);
  });


  test("awaits ledger appends in order before forwarding", async () => {
    const order: string[] = [];
    const verdict = await interceptCall(call, {
      classify: () => classified("r0"),
      policy: () => ({ kind: "allow" }),
      hold: async () => { throw new Error("hold should not run"); },
      ledger: async (entry) => {
        await Promise.resolve();
        order.push(entry.decision);
      },
    });

    assert.deepEqual(verdict, { kind: "allow" });
    assert.deepEqual(order, ["allow", "allow:resolved"]);
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
      ledger: (entry) => { ledger.push(entry); },
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
      ledger: (entry) => { ledger.push(entry); },
    });

    const stored = JSON.stringify(ledger);
    assert.match(stored, /[0-9a-f]{64}/);
    assert.doesNotMatch(stored, /secret_table/);
  });
});


test("probe radius replaces the argument fallback before policy", async () => {
  const verdict = await interceptCall(call, {
    classify: () => classified("r2"),
    probe: async (policyCall) => {
      assert.equal(policyCall.blastRadius, 12);
      assert.deepEqual(policyCall.args, call.args);
      return { radius: 41 };
    },
    policy: (policyCall) => {
      assert.equal(policyCall.blastRadius, 41);
      return { kind: "allow" };
    },
    hold: async () => { throw new Error("hold should not run"); },
    ledger: () => {},
  });

  assert.deepEqual(verdict, { kind: "allow" });
});

test("probe error keeps fallback radius and still decides", async () => {
  const verdict = await interceptCall(call, {
    classify: () => classified("r2"),
    probe: async () => ({ error: "probe timed out" }),
    policy: (policyCall) => {
      assert.equal(policyCall.blastRadius, 12);
      return { kind: "allow" };
    },
    hold: async () => { throw new Error("hold should not run"); },
    ledger: () => {},
  });

  assert.deepEqual(verdict, { kind: "allow" });
});

test("probe facts can be merged while declared facts win conflicts", async () => {
  const declaredFacts = { "bucket.versioning": "Disabled" };
  const seenFacts: Array<Readonly<Record<string, string>>> = [];
  const verdict = await interceptCall({ ...call, tool: "aws.s3.object.delete", connector: "s3" }, {
    classify: (probeFacts) => {
      const facts = { ...probeFacts, ...declaredFacts };
      seenFacts.push(facts);
      return facts["bucket.versioning"] === "Disabled" ? classified("r3") : classified("r0");
    },
    probe: async () => ({ facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" } }),
    policy: (policyCall) => {
      assert.equal(policyCall.klass, "r3");
      return { kind: "allow" };
    },
    hold: async () => { throw new Error("hold should not run"); },
    ledger: () => {},
  });

  assert.deepEqual(verdict, { kind: "allow" });
  assert.deepEqual(seenFacts, [
    { "bucket.versioning": "Disabled" },
    { "bucket.versioning": "Disabled", "bucket.mfa_delete": "off" },
  ]);
});

test("without a probe the argument fallback is unchanged", async () => {
  const verdict = await interceptCall({ ...call, args: { n: 3 } }, {
    classify: () => classified("r1"),
    policy: (policyCall) => {
      assert.equal(policyCall.blastRadius, 3);
      return { kind: "deny", ruleIndex: 1, rationale: "regression lock" };
    },
    hold: async () => { throw new Error("hold should not run"); },
    ledger: () => {},
  });

  assert.equal(verdict.kind, "deny");
  assert.match((verdict as { error: JsonRpcError }).error.error.message, /blast radius 3/);
});

test("probe dispatcher uses cache so executor is not invoked on a hit", async () => {
  type Executor = { runs: number };
  const executor: Executor = { runs: 0 };
  const probe: ConnectorProbe<Executor> = {
    id: "demo",
    async run(_call, exec) {
      exec.runs += 1;
      return { radius: exec.runs, facts: { measured: String(exec.runs) } };
    },
  };
  const memo = new Map<string, Awaited<ReturnType<typeof probe.run>>>();
  const cache: ProbeCache<Executor> = {
    async run(item, probeCall, exec) {
      const key = `${item.id}:${JSON.stringify(probeCall)}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const result = await item.run(probeCall, exec);
      memo.set(key, result);
      return result;
    },
  };
  const dispatch = probeDispatcher(() => [probe], cache, executor);
  const policyCall = {
    tool: "postgres.row.delete",
    connector: "postgres",
    workspace: undefined,
    klass: "r2",
    blastRadius: undefined,
    args: { table: "users" },
  };

  assert.deepEqual(await dispatch(policyCall), { radius: 1, facts: { measured: "1" } });
  assert.deepEqual(await dispatch(policyCall), { radius: 1, facts: { measured: "1" } });
  assert.equal(executor.runs, 1);
});
