import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  managedPostgresAdapter,
  installManagedPostgres,
  type ManagedPostgresOptions,
} from "./managed.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type ExecutionRequest,
} from "../../../runtime/src/index.ts";
import { devKeyProvider } from "../../../ledger/src/sign.ts";
async function fixture(t: import("node:test").TestContext) {
  const db = new PGlite(),
    root = await mkdtemp(join(tmpdir(), "void-managed-pg-"));
  t.after(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
  await db.exec(
    "CREATE TABLE account(id integer PRIMARY KEY, balance integer NOT NULL CHECK(balance>=0), note text); INSERT INTO account VALUES(1,10,'original'),(2,90,'untouched')",
  );
  const options: ManagedPostgresOptions = {
    workspace: "test",
    schema: "void_recovery",
    tables: [
      {
        table: "public.account",
        primaryKey: ["id"],
        columns: ["balance", "note"],
      },
    ],
    connect: async () => ({
      query: async <T>(sql: string, params?: readonly unknown[]) =>
        (await db.query<T>(sql, params ? [...params] : [])).rows,
      close: async () => {},
    }),
  };
  await installManagedPostgres(options);
  const signer = await devKeyProvider({ dir: join(root, "keys"), env: {} }),
    runtimeOptions = {
      journal: localOperationJournal(join(root, "journal"), signer),
      vault: localRecoveryVault(
        join(root, "vault"),
        { first: randomBytes(32) },
        "first",
      ),
      adapters: [managedPostgresAdapter(options)],
      authorize: async () => true,
    };
  const request: ExecutionRequest = {
    workspace: "test",
    operationId: "op",
    agentId: "agent",
    runId: "run",
    adapterId: runtimeOptions.adapters[0]!.id,
    arguments: {
      table: "public.account",
      action: "update",
      key: { id: 1 },
      values: { balance: 20 },
    },
  };
  return { db, options, runtimeOptions, request };
}
test("managed PostgreSQL capture, write and outbox are integrated; restarted runtime restores exact rows", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.runtimeOptions);
  assert.equal((await runtime.execute(f.request)).status, "succeeded");
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select count(*)::int as n from void_recovery.operations",
      )
    ).rows[0]?.n,
    1,
  );
  const fresh = recoveryRuntime({
    ...f.runtimeOptions,
    adapters: [managedPostgresAdapter(f.options)],
  });
  const plan = await fresh.planRecovery("test", "op");
  assert.equal(
    (await fresh.recover(plan, async () => true)).status,
    "restored",
  );
  assert.deepEqual(
    (
      await f.db.query<Record<string, unknown>>(
        "select * from account order by id",
      )
    ).rows,
    [
      { id: 1, balance: 10, note: "original" },
      { id: 2, balance: 90, note: "untouched" },
    ],
  );
  assert.equal(
    (await fresh.recover(plan, async () => true)).status,
    "restored",
  );
});
test("managed PostgreSQL INSERT and DELETE restore supported row state", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.runtimeOptions);
  for (const [operationId, action, key, values] of [
    ["insert", "insert", { id: 3 }, { balance: 30, note: "new" }],
    ["delete", "delete", { id: 1 }, {}],
  ] as const) {
    assert.equal(
      (
        await runtime.execute({
          ...f.request,
          operationId,
          arguments: { table: "public.account", action, key, values },
        })
      ).status,
      "succeeded",
    );
    assert.equal(
      (
        await runtime.recover(
          await runtime.planRecovery("test", operationId),
          async () => true,
        )
      ).status,
      "restored",
    );
  }
  assert.deepEqual(
    (
      await f.db.query<Record<string, unknown>>(
        "select id from account order by id",
      )
    ).rows,
    [{ id: 1 }, { id: 2 }],
  );
});
test("managed revision detects human ABA and preserves human writes", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime(f.runtimeOptions);
  await runtime.execute(f.request);
  await f.db.exec(
    "update account set balance=99 where id=1; update account set balance=20 where id=1",
  );
  assert.equal(
    (
      await runtime.recover(
        await runtime.planRecovery("test", "op"),
        async () => true,
      )
    ).status,
    "conflict",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    20,
  );
});
test("target drift during authorization blocks dispatch; constraints roll back mutation and receipt", async (t) => {
  const f = await fixture(t),
    runtime = recoveryRuntime({
      ...f.runtimeOptions,
      authorize: async () => {
        await f.db.exec("update account set balance=15 where id=1");
        return true;
      },
    });
  assert.equal((await runtime.execute(f.request)).status, "failed");
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    15,
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select count(*)::int as n from void_recovery.operations",
      )
    ).rows[0]?.n,
    0,
  );
  const normal = recoveryRuntime(f.runtimeOptions);
  assert.equal(
    (
      await normal.execute({
        ...f.request,
        operationId: "invalid",
        arguments: {
          table: "public.account",
          action: "update",
          key: { id: 1 },
          values: { balance: -10 },
        },
      })
    ).status,
    "unknown",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    15,
  );
});
test("lost PostgreSQL commit response reconciles from transactionally stored outcome without retry", async (t) => {
  const f = await fixture(t),
    adapter = f.runtimeOptions.adapters[0]!,
    execute = adapter.execute;
  adapter.execute = async (...args) => {
    await execute(...args);
    throw new Error("lost response");
  };
  const runtime = recoveryRuntime(f.runtimeOptions);
  assert.equal((await runtime.execute(f.request)).status, "unknown");
  const fresh = recoveryRuntime({
    ...f.runtimeOptions,
    adapters: [managedPostgresAdapter(f.options)],
  });
  assert.equal((await fresh.reconcile("test", "op")).status, "succeeded");
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select count(*)::int as n from void_recovery.operations",
      )
    ).rows[0]?.n,
    1,
  );
});
test("disabled revision trigger fails closed before mutation", async (t) => {
  const f = await fixture(t);
  await f.db.exec("ALTER TABLE account DISABLE TRIGGER USER");
  assert.equal(
    (await recoveryRuntime(f.runtimeOptions).execute(f.request)).status,
    "failed",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    10,
  );
});
test("lost recovery response reconciles durable receipt after restart without a second inverse", async (t) => {
  const f = await fixture(t),
    adapter = f.runtimeOptions.adapters[0]!,
    recover = adapter.recover;
  const runtime = recoveryRuntime(f.runtimeOptions);
  await runtime.execute(f.request);
  const plan = await runtime.planRecovery("test", "op");
  adapter.recover = async (...args) => {
    await recover(...args);
    throw new Error("lost recovery response");
  };
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "unknown",
  );
  const fresh = recoveryRuntime({
    ...f.runtimeOptions,
    adapters: [managedPostgresAdapter(f.options)],
  });
  assert.equal(
    (await fresh.reconcileRecovery("test", "op")).status,
    "restored",
  );
  assert.equal(
    (await fresh.reconcileRecovery("test", "op")).status,
    "restored",
  );
  assert.equal(
    (await fresh.recover(plan, async () => true)).status,
    "restored",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select count(*)::int as n from void_recovery.recoveries",
      )
    ).rows[0]?.n,
    1,
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    10,
  );
});
test("uncertified row-level security refuses execution even for an owner that bypasses policies", async (t) => {
  const f = await fixture(t);
  await f.db.exec("ALTER TABLE account ENABLE ROW LEVEL SECURITY");
  assert.equal(
    (await recoveryRuntime(f.runtimeOptions).execute(f.request)).status,
    "failed",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "select balance from account where id=1",
      )
    ).rows[0]?.balance,
    10,
  );
});
