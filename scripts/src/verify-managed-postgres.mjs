// Opt-in real PostgreSQL test. Creates and removes only unique test-owned schemas.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import {
  managedPostgresAdapter,
  installManagedPostgres,
} from "../../packages/connectors/src/postgres/managed.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  reservedRecoveryVault,
} from "../../packages/runtime/src/index.ts";
import { devKeyProvider } from "../../packages/ledger/src/sign.ts";
assert.equal(
  process.env.VOID_RECOVERY_DATABASE_TEST,
  "1",
  "Explicit isolated test opt-in required.",
);
const url = new URL(process.env.DATABASE_URL);
assert.equal(
  url.pathname,
  "/void_gui_upgrade_preview",
  "Production databases are forbidden.",
);
assert.ok(
  !url.hostname.includes("-pooler"),
  "Use a direct connection for this test.",
);
neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({
  connectionString: url.href,
  max: 3,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 1000,
});
const suffix = randomBytes(8).toString("hex"),
  schema = "qa_recovery_" + suffix,
  metadata = "qa_recovery_meta_" + suffix;
const root = await mkdtemp(join(tmpdir(), "void-real-postgres-"));
const connect = async () => {
  const c = await pool.connect();
  return {
    query: async (sql, params) => (await c.query(sql, params)).rows,
    close: async () => c.release(),
  };
};
const db = await connect();
let created = false;
try {
  await db.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await db.query(
    `CREATE TABLE "${schema}".account(id integer PRIMARY KEY,balance integer NOT NULL CHECK(balance>=0)); INSERT INTO "${schema}".account VALUES(1,10),(2,90)`,
  );
  const options = {
    workspace: "qa-test",
    schema: metadata,
    tables: [
      { table: schema + ".account", primaryKey: ["id"], columns: ["balance"] },
    ],
    connect,
  };
  await installManagedPostgres(options);
  const signer = await devKeyProvider({ dir: join(root, "keys"), env: {} });
  const base = {
    journal: localOperationJournal(join(root, "journal"), signer),
    vault: reservedRecoveryVault(
      join(root, "vault"),
      { test: randomBytes(32) },
      "test",
    ),
    authorize: async () => true,
  };
  let adapter = managedPostgresAdapter(options),
    runtime = recoveryRuntime({ ...base, adapters: [adapter] });
  const request = {
    workspace: "qa-test",
    operationId: randomUUID(),
    agentId: "test-agent",
    runId: "test-run",
    adapterId: adapter.id,
    arguments: {
      table: schema + ".account",
      action: "update",
      key: { id: 1 },
      values: { balance: 20 },
    },
  };
  assert.equal((await runtime.execute(request)).status, "succeeded");
  adapter = managedPostgresAdapter(options);
  runtime = recoveryRuntime({ ...base, adapters: [adapter] });
  let plan = await runtime.planRecovery("qa-test", request.operationId);
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "restored",
  );
  assert.deepEqual(
    await db.query(`SELECT * FROM "${schema}".account ORDER BY id`),
    [
      { id: 1, balance: 10 },
      { id: 2, balance: 90 },
    ],
  );
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "restored",
  );
  const second = { ...request, operationId: randomUUID() };
  assert.equal((await runtime.execute(second)).status, "succeeded");
  await db.query(
    `UPDATE "${schema}".account SET balance=99 WHERE id=1; UPDATE "${schema}".account SET balance=20 WHERE id=1`,
  );
  plan = await runtime.planRecovery("qa-test", second.operationId);
  assert.equal(
    (await runtime.recover(plan, async () => true)).status,
    "conflict",
  );
  const third = {
    ...request,
    operationId: randomUUID(),
    arguments: { ...request.arguments, values: { balance: 30 } },
  };
  const execute = adapter.execute;
  adapter.execute = async (...args) => {
    await execute(...args);
    throw new Error("Injected lost commit response");
  };
  assert.equal((await runtime.execute(third)).status, "unknown");
  runtime = recoveryRuntime({
    ...base,
    adapters: [managedPostgresAdapter(options)],
  });
  assert.equal(
    (await runtime.reconcile("qa-test", third.operationId)).status,
    "succeeded",
  );
  assert.equal(
    (
      await runtime.recover(
        await runtime.planRecovery("qa-test", third.operationId),
        async () => true,
      )
    ).status,
    "restored",
  );
  // Force a real SERIALIZABLE conflict during prepare: the human commits
  // after the executor has read its snapshot but before SELECT FOR UPDATE.
  const human = await connect();
  let reached, proceed, seenCode;
  const preparing = new Promise((resolve) => {
      reached = resolve;
    }),
    resume = new Promise((resolve) => {
      proceed = resolve;
    });
  const concurrentOptions = {
    ...options,
    connect: async () => {
      const c = await connect();
      return {
        close: c.close,
        query: async (sql, params) => {
          if (sql.includes("FOR UPDATE")) {
            await c.query(`SELECT balance FROM "${schema}".account WHERE id=1`);
            reached();
            await resume;
          }
          try {
            return await c.query(sql, params);
          } catch (error) {
            seenCode = error.code;
            throw error;
          }
        },
      };
    },
  };
  try {
    await human.query("BEGIN");
    await human.query(`UPDATE "${schema}".account SET balance=40 WHERE id=1`);
    const operation = recoveryRuntime({
      ...base,
      adapters: [managedPostgresAdapter(concurrentOptions)],
    }).execute({ ...request, operationId: randomUUID() });
    await Promise.race([
      preparing,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Prepare synchronization timed out")),
          15000,
        ).unref(),
      ),
    ]);
    await human.query("COMMIT");
    proceed();
    assert.equal((await operation).status, "failed");
    assert.equal(seenCode, "40001");
    assert.equal(
      (await db.query(`SELECT balance FROM "${schema}".account WHERE id=1`))[0]
        .balance,
      40,
    );
  } finally {
    proceed();
    await human.query("ROLLBACK").catch(() => {});
    await human.close();
  }
  // PostgreSQL deadlock detection against two independent test-only transactions.
  const left = await connect(),
    right = await connect();
  try {
    await left.query("BEGIN; SET LOCAL statement_timeout='8s'");
    await right.query("BEGIN; SET LOCAL statement_timeout='8s'");
    await left.query(
      `UPDATE "${schema}".account SET balance=balance+1 WHERE id=1`,
    );
    await right.query(
      `UPDATE "${schema}".account SET balance=balance+1 WHERE id=2`,
    );
    const deadlock = await Promise.allSettled([
      left.query(`UPDATE "${schema}".account SET balance=balance+1 WHERE id=2`),
      right.query(
        `UPDATE "${schema}".account SET balance=balance+1 WHERE id=1`,
      ),
    ]);
    assert.ok(
      deadlock.some(
        (result) =>
          result.status === "rejected" && result.reason.code === "40P01",
      ),
    );
  } finally {
    await left.query("ROLLBACK");
    await right.query("ROLLBACK");
    await left.close();
    await right.close();
  }
  assert.deepEqual(
    await db.query(`SELECT * FROM "${schema}".account ORDER BY id`),
    [
      { id: 1, balance: 40 },
      { id: 2, balance: 90 },
    ],
  );
  console.log(
    JSON.stringify({
      passed: true,
      backend: "real PostgreSQL / Neon",
      checks: [
        "integrated capture and commit",
        "restart and restore",
        "idempotent recovery",
        "human ABA conflict",
        "injected lost response reconciliation",
        "signed journal verification on reload",
        "capacity reservation vault",
        "real serialization conflict before dispatch",
        "isolated PostgreSQL deadlock rollback",
      ],
      networkPartitionTest: false,
    }),
  );
} finally {
  try {
    if (created) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS "${metadata}" CASCADE`);
    }
  } finally {
    await db.close();
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
}
