import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  reservedRecoveryVault,
  localRecoveryVault,
  localOperationJournal,
  recoveryRuntime,
  type RecoveryAdapter,
  type Json,
} from "./index.ts";
async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "void-reserved-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, keys: { first: randomBytes(32), second: randomBytes(32) } };
}

test("durable reservations cap concurrent writers, survive restart and preserve room for recovery", async (t) => {
  const f = await fixture(t),
    capacity = { maxArtifactBytes: 1024, maxTotalBytes: 3 * 1052 };
  const first = reservedRecoveryVault(f.root, f.keys, "first", capacity),
    second = reservedRecoveryVault(f.root, f.keys, "first", capacity);
  const results = await Promise.allSettled([
    first.reserve!("one", "a"),
    second.reserve!("two", "b"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const [workspace, operationId] =
    results[0]!.status === "fulfilled" ? ["one", "a"] : ["two", "b"];
  const restart = reservedRecoveryVault(f.root, f.keys, "second", capacity);
  await restart.reserve!(workspace!, operationId!);
  await assert.rejects(restart.reserve!("other", "extra"), /quota/);
  const capture = await restart.put(workspace!, "private old bytes", {
    operationId: operationId!,
    slot: "capture",
  });
  await restart.put(workspace!, "result", {
    operationId: operationId!,
    slot: "outcome",
  });
  // Unrelated traffic can consume only unreserved room, never the inverse's slot.
  await restart.put("other", "x".repeat(1022));
  await assert.rejects(restart.put("other", "y".repeat(1022)), /quota/);
  const receipt = await restart.put(workspace!, "restored", {
    operationId: operationId!,
    slot: "recovery",
  });
  assert.equal(await restart.get(workspace!, capture), "private old bytes");
  assert.equal(await restart.get(workspace!, receipt), "restored");
  assert.equal(
    (await readFile(join(f.root, "vault.sqlite"))).includes(
      Buffer.from("private old bytes"),
    ),
    false,
  );
});
test("slot retry returns the same artifact and rejects changed evidence or another workspace", async (t) => {
  const f = await fixture(t),
    vault = reservedRecoveryVault(f.root, f.keys, "first");
  await vault.reserve!("one", "op");
  const reference = await vault.put(
    "one",
    { value: "before" },
    { operationId: "op", slot: "capture" },
  );
  assert.deepEqual(
    await vault.put(
      "one",
      { value: "before" },
      { operationId: "op", slot: "capture" },
    ),
    reference,
  );
  await assert.rejects(
    vault.put(
      "one",
      { value: "changed" },
      { operationId: "op", slot: "capture" },
    ),
    /different evidence/,
  );
  await assert.rejects(vault.get("two", reference));
  await vault.release!("one", "op");
  assert.deepEqual(await vault.get("one", reference), { value: "before" });
  await assert.rejects(
    vault.put("one", "result", { operationId: "op", slot: "outcome" }),
    /not reserved/,
  );
});
test("legacy snapshots remain readable and consume quota; new configuration cannot reset the shared limit", async (t) => {
  const f = await fixture(t),
    old = localRecoveryVault(f.root, f.keys, "first", 1024),
    reference = await old.put("one", "legacy");
  const capacity = { maxArtifactBytes: 1024, maxTotalBytes: 3 * 1052 };
  const vault = reservedRecoveryVault(f.root, f.keys, "second", capacity);
  assert.equal(await vault.get("one", reference), "legacy");
  await assert.rejects(vault.reserve!("one", "op"), /quota/);
  await assert.rejects(
    reservedRecoveryVault(f.root, f.keys, "second", {
      ...capacity,
      maxTotalBytes: 100000,
    }).reserve!("one", "op"),
    /persisted configuration/,
  );
});
test("ciphertext tampering and unavailable keys refuse restore", async (t) => {
  const f = await fixture(t),
    vault = reservedRecoveryVault(f.root, f.keys, "first");
  const reference = await vault.put("one", "private");
  const rotated = reservedRecoveryVault(
    f.root,
    { second: f.keys.second },
    "second",
  );
  await assert.rejects(rotated.get("one", reference), /unavailable/);
  const db = new DatabaseSync(join(f.root, "vault.sqlite"));
  db.prepare("UPDATE artifacts SET data=? WHERE digest=?").run(
    Buffer.alloc(reference.bytes),
    reference.digest,
  );
  db.close();
  await assert.rejects(vault.get("one", reference), /mismatch/);
});
test("runtime refuses dispatch without capacity and reconciles a persisted result without consuming a second slot", async (t) => {
  const f = await fixture(t),
    dir = join(f.root, "vault"),
    capacity = { maxArtifactBytes: 2048, maxTotalBytes: 3 * 2076 },
    vault = reservedRecoveryVault(dir, f.keys, "first", capacity);
  const signer = await devKeyProvider({ dir: join(f.root, "keys"), env: {} }),
    journal = localOperationJournal(join(f.root, "journal"), signer);
  let writes = 0,
    value: Json = "before";
  const adapter: RecoveryAdapter = {
    id: "fixture",
    version: "1",
    async preflight() {
      return {
        effect: "write",
        reversibility: "r1",
        readiness: "verified",
        scope: "value",
        resources: ["value"],
        revision: value,
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare() {
      return { before: value, plan: null };
    },
    async execute(args) {
      writes++;
      value = args;
      return { result: value, evidence: null };
    },
    async release() {},
    async reconcile() {
      return {
        status: "succeeded",
        outcome: { result: value, evidence: null },
      };
    },
    async recover(prepared) {
      value = prepared.before;
      return { status: "restored", evidence: value };
    },
  };
  const request = {
    workspace: "one",
    agentId: "agent",
    runId: "run",
    operationId: "op",
    adapterId: adapter.id,
    arguments: "after",
  };
  await vault.reserve!("other", "blocking");
  const runtime = recoveryRuntime({
    journal,
    vault,
    adapters: [adapter],
    authorize: async () => true,
  });
  assert.deepEqual(await runtime.execute(request), {
    status: "failed",
    operationId: "op",
    reason: "recovery-capacity",
  });
  assert.equal((await runtime.execute(request)).reason, "recovery-capacity");
  assert.equal(writes, 0);
  await vault.release!("other", "blocking");
  let lost = true;
  const interrupted = recoveryRuntime({
    journal,
    vault: {
      ...vault,
      put: async (...args) => {
        const ref = await vault.put(...args);
        if (args[2]?.slot === "outcome" && lost) {
          lost = false;
          throw new Error("lost acknowledgement");
        }
        return ref;
      },
    },
    adapters: [adapter],
    authorize: async () => true,
  });
  assert.equal(
    (await interrupted.execute({ ...request, operationId: "working" })).status,
    "unknown",
  );
  assert.equal(writes, 1);
  const restarted = recoveryRuntime({
    journal,
    vault: reservedRecoveryVault(dir, f.keys, "second", capacity),
    adapters: [adapter],
    authorize: async () => true,
  });
  assert.equal(
    (await restarted.reconcile("one", "working")).status,
    "succeeded",
  );
  assert.equal(writes, 1);
  assert.equal(
    (
      await restarted.recover(
        await restarted.planRecovery("one", "working"),
        async () => true,
      )
    ).status,
    "restored",
  );
  assert.equal(value, "before");
});

test("SIGKILL before snapshot commit rolls back payload and quota together", async (t) => {
  const f = await fixture(t),
    root = join(f.root, "vault"),
    capacity = { maxArtifactBytes: 1024, maxTotalBytes: 3 * 1052 };
  const vault = reservedRecoveryVault(root, f.keys, "first", capacity);
  await vault.reserve!("one", "op");
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const code = `
 import {DatabaseSync} from 'node:sqlite';
 import {reservedRecoveryVault} from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
 const original=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT')process.kill(process.pid,'SIGKILL');return original.call(this,sql)};
 await reservedRecoveryVault(process.env.TEST_VAULT,{first:Buffer.from(process.env.TEST_KEY,'base64')},'first',${JSON.stringify(capacity)}).put('one','before',{operationId:'op',slot:'capture'});
 `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", code],
    {
      env: {
        ...process.env,
        TEST_VAULT: root,
        TEST_KEY: f.keys.first.toString("base64"),
      },
      stdio: "ignore",
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const [exit, signal] = await once(child, "exit", {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(exit, null);
  assert.equal(signal, "SIGKILL");
  const restarted = reservedRecoveryVault(root, f.keys, "first", capacity);
  await assert.rejects(restarted.reserve!("other", "op", ["capture"]), /quota/);
  const reference = await restarted.put("one", "before", {
    operationId: "op",
    slot: "capture",
  });
  assert.equal(await restarted.get("one", reference), "before");
  assert.deepEqual(
    await restarted.put("one", "before", {
      operationId: "op",
      slot: "capture",
    }),
    reference,
  );
});
