import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type RecoveryAdapter,
  type Json,
  type ExecutionRequest,
  type Outcome,
} from "./index.ts";
async function fixture(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "void-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} }),
    keys = { test: randomBytes(32) };
  const journal = localOperationJournal(join(dir, "journal"), signer),
    vault = localRecoveryVault(join(dir, "vault"), keys, "test");
  let value: Json = "original",
    calls = 0,
    recoveries = 0,
    committed: Outcome | undefined;
  const adapter: RecoveryAdapter = {
    id: "fixture",
    version: "1",
    async preflight() {
      return {
        effect: "write",
        reversibility: "r1",
        readiness: "verified",
        scope: "one value",
        resources: ["fixture:value"],
        revision: value,
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare(args, observation) {
      assert.deepEqual(value, observation.revision);
      return { before: value, plan: args };
    },
    async execute(args) {
      calls++;
      value = args;
      committed = { result: args, evidence: { revision: args } };
      return committed;
    },
    async release() {},
    async reconcile() {
      return committed
        ? { status: "succeeded", outcome: committed }
        : { status: "unknown" };
    },
    async recover(prepared, outcome) {
      recoveries++;
      if (JSON.stringify(value) !== JSON.stringify(outcome.result))
        return { status: "conflict", evidence: null };
      value = prepared.before;
      return { status: "restored", evidence: { value } };
    },
  };
  const options = {
    journal,
    vault,
    adapters: [adapter],
    authorize: async () => true,
  };
  const request: ExecutionRequest = {
    workspace: "test",
    operationId: "op-1",
    agentId: "agent",
    runId: "run",
    adapterId: "fixture",
    arguments: "private-new-value",
  };
  return {
    dir,
    signer,
    keys,
    journal,
    vault,
    adapter,
    options,
    request,
    read: () => ({ value, calls, recoveries }),
    human: (v: Json) => {
      value = v;
    },
  };
}
test("durable execution, restart, signed recovery and repeated recovery preserve one effect", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  assert.equal((await runtime.execute(f.request)).status, "succeeded");
  const restarted = recoveryRuntime({
    ...f.options,
    journal: localOperationJournal(join(f.dir, "journal"), f.signer),
  });
  assert.equal(
    (await restarted.execute(f.request)).result,
    "private-new-value",
  );
  assert.equal(f.read().calls, 1);
  const plan = await restarted.planRecovery("test", "op-1");
  assert.equal(
    (await restarted.recover(plan, async () => true)).status,
    "restored",
  );
  assert.equal(
    (await restarted.recover(plan, async () => true)).status,
    "restored",
  );
  assert.deepEqual(f.read(), { value: "original", calls: 1, recoveries: 1 });
  const text = await readFile(join(f.dir, "journal/test.jsonl"), "utf8");
  assert.ok(!text.includes("private-new-value"));
  assert.ok(text.includes('"reverses":"op-1"'));
});
test("same ID rejects changed request; concurrent instances dispatch once", async (t) => {
  const f = await fixture(t);
  await Promise.all([
    recoveryRuntime(f.options).execute(f.request),
    recoveryRuntime(f.options).execute(f.request),
  ]);
  assert.equal(f.read().calls, 1);
  await assert.rejects(
    recoveryRuntime(f.options).execute({
      ...f.request,
      arguments: "different",
    }),
    /Idempotency/,
  );
});
test("capture failure releases preparation and prevents actual dispatch", async (t) => {
  const f = await fixture(t);
  let released = false;
  f.adapter.release = async () => {
    released = true;
  };
  const runtime = recoveryRuntime({
    ...f.options,
    vault: {
      ...f.vault,
      put: async () => {
        throw new Error("disk full");
      },
    },
  });
  assert.equal((await runtime.execute(f.request)).status, "failed");
  assert.equal(f.read().calls, 0);
  assert.equal(released, true);
});
test("lost execution response is unknown; retry never dispatches; explicit reconcile proves result", async (t) => {
  const f = await fixture(t),
    execute = f.adapter.execute;
  f.adapter.execute = async (...args) => {
    await execute(...args);
    throw new Error("response lost");
  };
  const runtime = recoveryRuntime(f.options);
  assert.equal((await runtime.execute(f.request)).status, "unknown");
  assert.equal((await runtime.execute(f.request)).status, "unknown");
  assert.equal(f.read().calls, 1);
  assert.equal((await runtime.reconcile("test", "op-1")).status, "succeeded");
  assert.equal(f.read().calls, 1);
});
test("failure storing the outcome after commit remains unknown", async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const runtime = recoveryRuntime({
    ...f.options,
    vault: {
      ...f.vault,
      put: async (...args) => {
        if (++writes === 2) throw new Error("disk full");
        return f.vault.put(...args);
      },
    },
  });
  assert.equal((await runtime.execute(f.request)).status, "unknown");
  assert.equal(f.read().calls, 1);
  assert.equal((await runtime.reconcile("test", "op-1")).status, "succeeded");
});
test("human drift is retained; changed preview cannot reuse approval", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  const plan = await runtime.planRecovery("test", "op-1");
  await assert.rejects(
    runtime.recover({ ...plan, resources: ["other"] }, async () => true),
    /plan changed/,
  );
  f.human("human change");
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "conflict",
  );
  assert.equal(f.read().value, "human change");
});
test("tampered journal, unavailable encryption key and capture substitution fail closed", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  const other = localRecoveryVault(
    join(f.dir, "vault"),
    { other: randomBytes(32) },
    "other",
  );
  await assert.rejects(
    recoveryRuntime({ ...f.options, vault: other }).planRecovery(
      "test",
      "op-1",
    ),
    /unavailable/,
  );
  const path = join(f.dir, "journal/test.jsonl"),
    text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace('"agentId":"agent"', '"agentId":"attacker"'),
  );
  await assert.rejects(runtime.execute(f.request), /verification/);
  assert.equal(f.read().calls, 1);
});
test("recovery response loss is unknown and cannot cause an automatic second inverse", async (t) => {
  const f = await fixture(t),
    recover = f.adapter.recover;
  f.adapter.recover = async (...args) => {
    await recover(...args);
    throw new Error("response lost");
  };
  const runtime = recoveryRuntime(f.options);
  await runtime.execute(f.request);
  const plan = await runtime.planRecovery("test", "op-1");
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "unknown",
  );
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "unknown",
  );
  assert.equal(f.read().recoveries, 1);
});
test("denied authorization and unsupported recovery never capture or dispatch", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await recoveryRuntime({
        ...f.options,
        authorize: async () => false,
      }).execute(f.request)
    ).status,
    "denied",
  );
  const original = f.adapter.preflight;
  f.adapter.preflight = async (...args) => ({
    ...(await original(...args)),
    readiness: "unsupported",
  });
  assert.equal(
    (
      await recoveryRuntime(f.options).execute({
        ...f.request,
        operationId: "op-2",
      })
    ).status,
    "denied",
  );
  assert.equal(f.read().calls, 0);
});
test("vault authenticates workspace and ciphertext; artifacts survive key rotation", async (t) => {
  const f = await fixture(t),
    reference = await f.vault.put("test", { secret: "private" });
  const rotated = localRecoveryVault(
    join(f.dir, "vault"),
    { ...f.keys, next: randomBytes(32) },
    "next",
  );
  assert.deepEqual(await rotated.get("test", reference), { secret: "private" });
  await assert.rejects(rotated.get("other", reference));
  const path = join(f.dir, "vault/test", reference.digest),
    data = await readFile(path);
  data[30] ^= 1;
  await writeFile(path, data);
  await assert.rejects(rotated.get("test", reference), /digest/);
});
