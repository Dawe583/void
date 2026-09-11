import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  managedPostgresAdapter,
  installManagedPostgres,
  type ManagedPostgresOptions,
} from "./managed.ts";
import type { Json, Prepared } from "../recovery.ts";

async function fixture(t: import("node:test").TestContext) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "CREATE TABLE account(id integer PRIMARY KEY, balance integer NOT NULL); INSERT INTO account VALUES(1,10),(2,20)",
  );
  const options: ManagedPostgresOptions = {
    workspace: "test",
    schema: "void_recovery",
    tables: [
      { table: "public.account", primaryKey: ["id"], columns: ["balance"] },
    ],
    connect: async () => ({
      query: async <T>(sql: string, params?: readonly unknown[]) =>
        (await db.query<T>(sql, params ? [...params] : [])).rows,
      close: async () => {},
    }),
  };
  await installManagedPostgres(options);
  const adapter = managedPostgresAdapter(options);
  const args = (id: number, balance: number): Json => ({
    table: "public.account",
    action: "update",
    key: { id },
    values: { balance },
  });
  async function execute(id: string, row: number, balance: number) {
    const input = args(row, balance),
      observation = await adapter.preflight(input);
    const prepared = await adapter.prepare(input, observation, id);
    try {
      return { prepared, outcome: await adapter.execute(input, prepared, id) };
    } finally {
      await adapter.release(id);
    }
  }
  return { db, options, adapter, args, execute };
}

test("a recovery ID cannot claim success for a different operation capture", async (t) => {
  const f = await fixture(t),
    first = await f.execute("one", 1, 11),
    second = await f.execute("two", 2, 22);
  assert.equal(
    (await f.adapter.recover(first.prepared, first.outcome, "recovery")).status,
    "restored",
  );
  await assert.rejects(
    f.adapter.recover(second.prepared, second.outcome, "recovery"),
    /identity|digest|match|another/i,
  );
  assert.deepEqual(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT * FROM account ORDER BY id",
      )
    ).rows,
    [
      { id: 1, balance: 10 },
      { id: 2, balance: 22 },
    ],
  );
});

test("reconciliation rejects a capture belonging to another operation", async (t) => {
  const f = await fixture(t),
    first = await f.execute("one", 1, 11),
    second = await f.execute("two", 2, 22);
  await assert.rejects(
    f.adapter.reconcile("one", second.prepared),
    /identity|digest|match|capture/i,
  );
  assert.equal(
    (await f.adapter.reconcile("one", first.prepared)).status,
    "succeeded",
  );
});

test("recovery rejects a substituted before image instead of overwriting with invented data", async (t) => {
  const f = await fixture(t),
    operation = await f.execute("one", 1, 11);
  const substituted: Prepared = {
    ...operation.prepared,
    before: { id: 1, balance: 999 },
  };
  await assert.rejects(
    f.adapter.recover(substituted, operation.outcome, "recovery"),
    /identity|digest|match|capture/i,
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT balance FROM account WHERE id=1",
      )
    ).rows[0]?.balance,
    11,
  );
});

test("a replacement trigger function cannot conceal intervening human ABA writes", async (t) => {
  const f = await fixture(t),
    operation = await f.execute("one", 1, 11);
  const fn = (
    await f.db.query<{ name: string }>(
      "SELECT p.proname AS name FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='account'::regclass AND NOT t.tgisinternal",
    )
  ).rows[0]!.name;
  assert.match(fn, /^revision_[a-f0-9]+$/);
  await f.db.exec(
    `CREATE OR REPLACE FUNCTION void_recovery.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; UPDATE account SET balance=30 WHERE id=1; UPDATE account SET balance=11 WHERE id=1`,
  );
  let rejected = false;
  try {
    rejected =
      (
        await f.adapter.recover(
          operation.prepared,
          operation.outcome,
          "recovery",
        )
      ).status === "conflict";
  } catch {
    rejected = true;
  }
  assert.equal(
    rejected,
    true,
    "a changed revision trigger must invalidate certification",
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT balance FROM account WHERE id=1",
      )
    ).rows[0]?.balance,
    11,
  );
});

test("failed receipt insertion rolls back the business mutation", async (t) => {
  const f = await fixture(t);
  await f.db.exec(
    "ALTER TABLE void_recovery.operations ADD CONSTRAINT reject_receipt CHECK(false)",
  );
  await assert.rejects(f.execute("one", 1, 11));
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT balance FROM account WHERE id=1",
      )
    ).rows[0]?.balance,
    10,
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM void_recovery.operations",
      )
    ).rows[0]?.n,
    0,
  );
});

test("failed recovery receipt insertion rolls back the inverse", async (t) => {
  const f = await fixture(t),
    operation = await f.execute("one", 1, 11);
  await f.db.exec(
    "ALTER TABLE void_recovery.recoveries ADD CONSTRAINT reject_receipt CHECK(false)",
  );
  await assert.rejects(
    f.adapter.recover(operation.prepared, operation.outcome, "recovery"),
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT balance FROM account WHERE id=1",
      )
    ).rows[0]?.balance,
    11,
  );
  assert.equal(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM void_recovery.recoveries",
      )
    ).rows[0]?.n,
    0,
  );
});

test("recreating a table at the same name invalidates the old target capture", async (t) => {
  const f = await fixture(t),
    operation = await f.execute("one", 1, 11);
  await f.db.exec(
    "DROP TABLE account; CREATE TABLE account(id integer PRIMARY KEY, balance integer NOT NULL); INSERT INTO account VALUES(1,11),(2,200)",
  );
  await installManagedPostgres(f.options);
  let rejected = false;
  try {
    rejected =
      (
        await f.adapter.recover(
          operation.prepared,
          operation.outcome,
          "recovery",
        )
      ).status === "conflict";
  } catch {
    rejected = true;
  }
  assert.equal(
    rejected,
    true,
    "a replacement relation must not inherit an old relation recovery",
  );
  assert.deepEqual(
    (
      await f.db.query<Record<string, unknown>>(
        "SELECT * FROM account ORDER BY id",
      )
    ).rows,
    [
      { id: 1, balance: 11 },
      { id: 2, balance: 200 },
    ],
  );
});
