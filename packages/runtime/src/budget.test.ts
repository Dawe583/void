import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type RecoveryAdapter,
  type ExecutionRequest,
  validateBudget,
} from "./index.ts";

test("100 concurrent requests across runtime instances cannot exceed two daily irreversible calls; unknown and restart preserve spend", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} }),
    vault = localRecoveryVault(
      join(dir, "vault"),
      { key: randomBytes(32) },
      "key",
    );
  let dispatches = 0;
  const adapter: RecoveryAdapter = {
    id: "terminal-fixture",
    version: "1",
    async preflight() {
      return {
        effect: "write",
        reversibility: "r3",
        readiness: "unsupported",
        scope: "irreversible test counter",
        resources: ["counter"],
        revision: null,
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare() {
      return { before: null, plan: { inverse: false } };
    },
    async execute() {
      dispatches++;
      throw new Error("lost response after effect");
    },
    async release() {},
    async reconcile() {
      return { status: "unknown" };
    },
    async recover() {
      throw new Error("no inverse");
    },
  };
  const create = () =>
    recoveryRuntime({
      journal: localOperationJournal(join(dir, "journal"), signer),
      vault,
      adapters: [adapter],
      authorize: async () => true,
      requireRecoverable: false,
      irreversibilityBudget: { dailyLimit: 2, perAgentDailyLimit: 1 },
    });
  const a = create(),
    b = create();
  const request = (i: number): ExecutionRequest => ({
    workspace: "test",
    operationId: "op-" + i,
    runId: "run",
    agentId: "agent-" + i,
    adapterId: adapter.id,
    arguments: null,
  });
  const result = await Promise.all(
    Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).execute(request(i))),
  );
  assert.equal(result.filter((r) => r.status === "unknown").length, 2);
  assert.equal(result.filter((r) => r.status === "denied").length, 98);
  assert.equal(dispatches, 2);
  assert.equal((await create().execute(request(100))).status, "denied");
  // Concurrent directory setup does not guarantee which request obtains the lock first.
  const admitted = result.findIndex((item) => item.status === "unknown");
  assert.equal((await create().execute(request(admitted))).status, "unknown");
  assert.equal(dispatches, 2);
});
test("invalid and fractional irreversible budgets fail closed", () => {
  for (const dailyLimit of [-1, NaN, Infinity, 1.5])
    assert.throws(() => validateBudget({ dailyLimit }));
  assert.doesNotThrow(() =>
    validateBudget({ dailyLimit: 0, perAgentDailyLimit: 0 }),
  );
});
