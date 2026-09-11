import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  digest,
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type RecoveryAdapter,
  type ExecutionRequest,
} from "./index.ts";
import type { Observation, Outcome } from "../../connectors/src/recovery.ts";

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "void-adversarial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(root, "keys"), env: {} });
  const keys = { first: randomBytes(32) };
  const vault = localRecoveryVault(join(root, "vault"), keys, "first");
  const journal = localOperationJournal(join(root, "journal"), signer);
  const observation: Observation = {
    effect: "write",
    reversibility: "r1",
    readiness: "verified",
    scope: "approved",
    resources: ["first"],
    revision: 0,
    blastRadius: { count: 1, precision: "exact" },
  };
  const recoveryCalls: { result: unknown; id: string }[] = [];
  let dispatches = 0;
  const adapter: RecoveryAdapter = {
    id: "test",
    version: "1",
    async preflight() {
      return observation;
    },
    async prepare(args) {
      return { before: null, plan: args };
    },
    async execute(args) {
      dispatches++;
      return { result: args, evidence: null };
    },
    async release() {},
    async reconcile() {
      return { status: "unknown" };
    },
    async recover(_prepared, outcome, id) {
      recoveryCalls.push({ result: outcome.result, id });
      return { status: "restored", evidence: null };
    },
  };
  const options = {
    journal,
    vault,
    adapters: [adapter],
    authorize: async () => true,
  };
  const request: ExecutionRequest = {
    workspace: "one",
    operationId: "first",
    agentId: "agent",
    runId: "run",
    adapterId: adapter.id,
    arguments: "first-result",
  };
  return {
    root,
    keys,
    vault,
    journal,
    adapter,
    observation,
    options,
    request,
    recoveryCalls,
    dispatches: () => dispatches,
  };
}

test("approval cannot mutate the retained preflight evidence before prepare", async (t) => {
  const f = await fixture(t);
  let preparedScope = "";
  f.adapter.prepare = async (_args, observation) => {
    preparedScope = observation.scope;
    return { before: null, plan: null };
  };
  const runtime = recoveryRuntime({
    ...f.options,
    authorize: async (approved) => {
      assert.equal(approved.observation.scope, "approved");
      f.observation.scope = "not-approved";
      f.observation.resources.push("second");
      return true;
    },
  });
  await runtime.execute(f.request);
  assert.equal(
    preparedScope,
    "approved",
    "prepare must consume the same observation that was approved",
  );
});

test("mutating caller recovery plan during approval cannot substitute another operation result", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  await runtime.execute({
    ...f.request,
    operationId: "second",
    arguments: "second-result",
  });
  const plan = await runtime.planRecovery("one", "first");
  await runtime.recover(plan, async () => {
    plan.operationId = "second";
    return true;
  });
  assert.deepEqual(f.recoveryCalls, [
    {
      result: "first-result",
      id: "recovery-" + digest({ workspace: "one", operationId: "first" }),
    },
  ]);
});

test("caller request mutation during approval does not alter execution", async (t) => {
  const f = await fixture(t);
  const runtime = recoveryRuntime({
    ...f.options,
    authorize: async () => {
      f.request.arguments = "changed";
      return true;
    },
  });
  assert.equal((await runtime.execute(f.request)).result, "first-result");
});

test("copied authenticated artifacts cannot be opened in another workspace", async (t) => {
  const f = await fixture(t),
    reference = await f.vault.put("one", { private: true });
  await mkdir(join(f.root, "vault", "two"));
  await copyFile(
    join(f.root, "vault", "one", reference.digest),
    join(f.root, "vault", "two", reference.digest),
  );
  await assert.rejects(f.vault.get("two", reference));
});

test("interrupted journal append fails closed before another dispatch", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  await appendFile(
    join(f.root, "journal", "one.jsonl"),
    '{"workspace":"one","seq":',
  );
  await assert.rejects(
    runtime.execute({ ...f.request, operationId: "second" }),
  );
  assert.equal(f.dispatches(), 1);
});

test("vault rejects nonfinite or nonpositive artifact limits", async (t) => {
  const f = await fixture(t);
  for (const limit of [NaN, Infinity, -1, 0]) {
    assert.throws(
      () => localRecoveryVault(join(f.root, "invalid"), f.keys, "first", limit),
      `invalid limit ${limit}`,
    );
  }
});

test("vault refuses oversized evidence while preserving prior recovery artifacts", async (t) => {
  const f = await fixture(t),
    vault = localRecoveryVault(join(f.root, "small"), f.keys, "first", 32);
  const ref = await vault.put("one", "preserved");
  await assert.rejects(vault.put("one", "x".repeat(33)), /quota/);
  assert.equal(await vault.get("one", ref), "preserved");
});

test("adapter version substitution cannot replay old recovery evidence", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  const plan = await runtime.planRecovery("one", "first");
  const changed = recoveryRuntime({
    ...f.options,
    adapters: [{ ...f.adapter, version: "2" }],
  });
  await assert.rejects(
    changed.recover(plan, async () => true),
    /version/,
  );
  assert.equal(f.recoveryCalls.length, 0);
});

test("operation identity passed to an adapter is isolated between workspaces", async (t) => {
  const f = await fixture(t),
    committed = new Map<string, Outcome>();
  f.adapter.execute = async (args, _prepared, operationId) => {
    const prior = committed.get(operationId);
    if (prior) return prior;
    const outcome = { result: args, evidence: null };
    committed.set(operationId, outcome);
    return outcome;
  };
  const runtime = recoveryRuntime(f.options);
  assert.equal((await runtime.execute(f.request)).result, "first-result");
  assert.equal(
    (
      await runtime.execute({
        ...f.request,
        workspace: "two",
        arguments: "second-workspace",
      })
    ).result,
    "second-workspace",
  );
  assert.equal(committed.size, 2);
});

test("expired recovery capability cannot bypass an irreversible execution budget", async (t) => {
  const f = await fixture(t);
  f.observation.readiness = "expired";
  // Classification is nominally r1, but the runtime itself cannot plan Undo for expired evidence.
  const runtime = recoveryRuntime({
    ...f.options,
    requireRecoverable: false,
    irreversibilityBudget: { dailyLimit: 0 },
  });
  assert.equal((await runtime.execute(f.request)).status, "denied");
  assert.equal(f.dispatches(), 0);
});
