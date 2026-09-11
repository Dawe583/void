import { createHash } from "node:crypto";
import { canonicalJson } from "../../../ledger/src/canonical.ts";
import type {
  Json,
  Observation,
  Outcome,
  Prepared,
  RecoveryAdapter,
} from "../recovery.ts";
import type { QueryExecutor } from "./capture.ts";
export interface ManagedConnection extends QueryExecutor {
  close(): Promise<void>;
}
export type ManagedTable = {
  table: string;
  primaryKey: string[];
  columns: string[];
};
export type ManagedPostgresOptions = {
  workspace: string;
  schema: string;
  tables: ManagedTable[];
  connect(): Promise<ManagedConnection>;
};
type Mutation = {
  table: string;
  action: "insert" | "update" | "delete";
  key: Record<string, Json>;
  values: Record<string, Json>;
};
const hash = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
const ident = (s: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    throw new Error("Unsupported SQL identifier.");
  return '"' + s + '"';
};
const tableName = (s: string) => {
  const parts = s.split(".");
  if (parts.length !== 2) throw new Error("Use an explicit schema.table.");
  return parts.map(ident).join(".");
};
const json = (value: unknown): Json => JSON.parse(canonicalJson(value));
function triggerSource(target: ManagedTable, schema: string): string {
  const pairs = (prefix: string) =>
    target.primaryKey
      .flatMap((k) => ["'" + k + "'", `to_jsonb(${prefix})->'${k}'`])
      .join(",");
  return `DECLARE old_key text; new_key text;
    BEGIN
     IF TG_OP <> 'INSERT' THEN old_key := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || jsonb_build_object(${pairs("OLD")})::text; END IF;
     IF TG_OP <> 'DELETE' THEN new_key := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || jsonb_build_object(${pairs("NEW")})::text; END IF;
     IF old_key IS NOT NULL THEN INSERT INTO ${schema}.revisions VALUES(old_key,1) ON CONFLICT(resource) DO UPDATE SET revision=${schema}.revisions.revision+1; END IF;
     IF new_key IS NOT NULL AND new_key IS DISTINCT FROM old_key THEN INSERT INTO ${schema}.revisions VALUES(new_key,1) ON CONFLICT(resource) DO UPDATE SET revision=${schema}.revisions.revision+1; END IF;
     RETURN NULL;
    END`;
}
/** Explicit installation on operator-selected tables. Never run implicitly during a tool call.
 * Revisions remain after deletion, so A -> B -> A cannot hide a conflicting write. */
export async function installManagedPostgres(
  options: ManagedPostgresOptions,
): Promise<void> {
  const schema = ident(options.schema),
    connection = await options.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await connection.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.revisions(resource text PRIMARY KEY, revision bigint NOT NULL)`,
    );
    await connection.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.operations(id text PRIMARY KEY, request_digest text NOT NULL, capture jsonb NOT NULL, outcome jsonb NOT NULL)`,
    );
    await connection.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.recoveries(id text PRIMARY KEY, input_digest text NOT NULL, outcome jsonb NOT NULL)`,
    );
    for (const target of options.tables) {
      const table = tableName(target.table);
      if (!target.primaryKey.length)
        throw new Error("A primary key is required.");
      target.primaryKey.forEach(ident);
      target.columns.forEach(ident);
      const suffix = hash(target.table).slice(0, 16),
        fn = `${schema}.${ident("revision_" + suffix)}`,
        trigger = ident("void_revision_" + suffix);
      await connection.query(
        `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $body$${triggerSource(target, schema)}$body$`,
      );
      await connection.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
      await connection.query(
        `CREATE TRIGGER ${trigger} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await connection.close();
  }
}
export function managedPostgresAdapter(
  options: ManagedPostgresOptions,
): RecoveryAdapter {
  const schema = ident(options.schema),
    tables = new Map(options.tables.map((t) => [t.table, t]));
  if (!/^[\w-]{1,100}$/.test(options.workspace))
    throw new Error("Invalid managed workspace.");
  const pending = new Map<
    string,
    {
      connection: ManagedConnection;
      mutation: Mutation;
      prepared: Prepared;
      digest: string;
    }
  >();
  const operationKey = (id: string) => options.workspace + ":" + id;
  function mutation(args: Json): Mutation {
    if (!args || Array.isArray(args) || typeof args !== "object")
      throw new Error("Expected a structured row mutation.");
    if (
      Object.keys(args).some(
        (k) => !["table", "action", "key", "values"].includes(k),
      )
    )
      throw new Error("Unexpected mutation argument.");
    const table =
      typeof args.table === "string" ? tables.get(args.table) : undefined;
    if (!table || !["insert", "update", "delete"].includes(String(args.action)))
      throw new Error("Table or action is not configured.");
    const key = args.key,
      values = args.values ?? {};
    if (
      !key ||
      typeof key !== "object" ||
      Array.isArray(key) ||
      !values ||
      typeof values !== "object" ||
      Array.isArray(values)
    )
      throw new Error("Expected key and values objects.");
    if (
      Object.keys(key).length !== table.primaryKey.length ||
      table.primaryKey.some(
        (k) =>
          !Object.hasOwn(key, k) ||
          key[k] === null ||
          typeof key[k] === "object",
      )
    )
      throw new Error("Exact non-null primary key required.");
    if (
      Object.keys(values).some(
        (k) => !table.columns.includes(k) || table.primaryKey.includes(k),
      )
    )
      throw new Error("Column is not writable.");
    if (
      (args.action === "update" && !Object.keys(values).length) ||
      (args.action === "delete" && Object.keys(values).length)
    )
      throw new Error("Invalid values for mutation action.");
    return {
      table: table.table,
      action: args.action as Mutation["action"],
      key,
      values,
    };
  }
  async function inspect(
    connection: ManagedConnection,
    m: Mutation,
    lock = false,
  ) {
    const target = tables.get(m.table)!,
      keys = Object.keys(m.key).sort();
    const resource = (
      await connection.query<{ resource: string }>(
        "SELECT $1::text || ':' || $2::jsonb::text AS resource",
        [m.table, canonicalJson(m.key)],
      )
    )[0]!.resource;
    if (lock)
      await connection.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [resource],
      );
    const row =
      (
        await connection.query<{ row: Json }>(
          `SELECT to_jsonb(target) AS row FROM ${tableName(m.table)} AS target WHERE ${keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(" AND ")}${lock ? " FOR UPDATE" : ""}`,
          keys.map((k) => m.key[k]),
        )
      )[0]?.row ?? null;
    const revision =
      (
        await connection.query<{ revision: string }>(
          `SELECT revision::text AS revision FROM ${schema}.revisions WHERE resource=$1`,
          [resource],
        )
      )[0]?.revision ?? "0";
    const expected = "void_revision_" + hash(m.table).slice(0, 16);
    const triggers = await connection.query<{
      tgname: string;
      tgenabled: string;
      prosrc: string;
      namespace: string;
      tgtype: number;
      unconditional: boolean;
    }>(
      `SELECT t.tgname,t.tgenabled,t.tgtype,t.tgqual IS NULL AS unconditional,p.prosrc,n.nspname AS namespace FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid=$1::regclass AND NOT t.tgisinternal`,
      [m.table],
    );
    if (
      triggers.length !== 1 ||
      triggers[0]?.tgname !== expected ||
      triggers[0]?.tgenabled !== "O" ||
      triggers[0]?.namespace !== options.schema ||
      triggers[0]?.prosrc.trim() !== triggerSource(target, schema).trim() ||
      triggers[0]?.tgtype !== 29 ||
      !triggers[0]?.unconditional
    )
      throw new Error(
        "Managed revision trigger missing or additional trigger requires certification.",
      );
    const actual = await connection.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.ord`,
      [m.table],
    );
    if (
      canonicalJson(actual.map((r) => r.name).sort()) !==
      canonicalJson([...target.primaryKey].sort())
    )
      throw new Error("Configured primary key does not match the database.");
    const complex = await connection.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_constraint WHERE contype='f' AND confrelid=$1::regclass`,
      [m.table],
    );
    if (complex[0]?.count !== "0")
      throw new Error("Referenced tables require a cascade-certified adapter.");
    const generated = await connection.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_attribute WHERE attrelid=$1::regclass AND (attgenerated<>'' OR attidentity<>'')`,
      [m.table],
    );
    if (generated[0]?.count !== "0")
      throw new Error(
        "Generated/identity columns require a certified restore strategy.",
      );
    const relation = (
      await connection.query<{
        oid: string;
        relkind: string;
        relrowsecurity: boolean;
        relhasrules: boolean;
        relispartition: boolean;
      }>(
        "SELECT oid::text,relkind,relrowsecurity,relhasrules,relispartition FROM pg_class WHERE oid=$1::regclass",
        [m.table],
      )
    )[0]!;
    if (
      relation.relkind !== "r" ||
      relation.relrowsecurity ||
      relation.relhasrules ||
      relation.relispartition
    )
      throw new Error(
        "RLS, rules, partitioned and nonordinary relations require separate certification.",
      );
    const relationOid = relation.oid;
    return { resource, row, revision, relationOid };
  }
  async function readReceipt(id: string) {
    const c = await options.connect();
    try {
      return (
        await c.query<{ outcome: Outcome; capture: Prepared }>(
          `SELECT outcome,capture FROM ${schema}.operations WHERE id=$1`,
          [operationKey(id)],
        )
      )[0];
    } finally {
      await c.close();
    }
  }
  return {
    id: "postgres-managed-" + options.workspace,
    version: "1",
    async preflight(args) {
      const m = mutation(args),
        c = await options.connect();
      try {
        const state = await inspect(c, m);
        return {
          effect: "write",
          reversibility: "r1",
          readiness: "verified",
          scope:
            "Configured PostgreSQL row values; excludes external observers and transaction history.",
          resources: [state.resource],
          revision: json(state),
          blastRadius: { count: 1, precision: "exact" },
        };
      } finally {
        await c.close();
      }
    },
    async prepare(args, observation, id) {
      if (pending.has(id)) throw new Error("Operation already prepared.");
      const m = mutation(args),
        c = await options.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const state = await inspect(c, m, true);
        if (canonicalJson(state) !== canonicalJson(observation.revision))
          throw new Error("Target changed since authorization.");
        if ((m.action === "insert") !== (state.row === null))
          throw new Error("Row existence precondition failed.");
        const prepared = {
          before: state.row,
          plan: json({
            mutation: m,
            resource: state.resource,
            beforeRevision: state.revision,
            operationKey: operationKey(id),
          }),
        };
        pending.set(id, {
          connection: c,
          mutation: m,
          prepared,
          digest: hash(args),
        });
        return prepared;
      } catch (error) {
        await c.query("ROLLBACK").catch(() => {});
        await c.close();
        throw error;
      }
    },
    async execute(args, prepared, id) {
      const p = pending.get(id);
      if (
        !p ||
        p.digest !== hash(args) ||
        canonicalJson(p.prepared) !== canonicalJson(prepared)
      )
        throw new Error("Preparation does not match dispatch.");
      const m = p.mutation,
        c = p.connection,
        keys = Object.keys(m.key).sort(),
        values = Object.keys(m.values).sort(),
        table = tableName(m.table);
      if (m.action === "insert") {
        const row = { ...m.key, ...m.values },
          columns = Object.keys(row).sort();
        await c.query(
          `INSERT INTO ${table} (${columns.map(ident).join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
          columns.map((k) => row[k]),
        );
      } else if (m.action === "update")
        await c.query(
          `UPDATE ${table} SET ${values.map((k, i) => `${ident(k)}=$${i + 1}`).join(",")} WHERE ${keys.map((k, i) => `${ident(k)}=$${values.length + i + 1}`).join(" AND ")}`,
          [...values.map((k) => m.values[k]), ...keys.map((k) => m.key[k])],
        );
      else
        await c.query(
          `DELETE FROM ${table} WHERE ${keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(" AND ")}`,
          keys.map((k) => m.key[k]),
        );
      const after = await inspect(c, m),
        outcome = { result: after.row, evidence: json(after) };
      await c.query(
        `INSERT INTO ${schema}.operations(id,request_digest,capture,outcome) VALUES($1,$2,$3::jsonb,$4::jsonb)`,
        [
          operationKey(id),
          p.digest,
          canonicalJson(prepared),
          canonicalJson(outcome),
        ],
      );
      await c.query("COMMIT");
      pending.delete(id);
      await c.close();
      return outcome;
    },
    async release(id) {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        try {
          await p.connection.query("ROLLBACK");
        } finally {
          await p.connection.close();
        }
      }
    },
    async reconcile(id, prepared) {
      const receipt = await readReceipt(id);
      if (receipt && canonicalJson(receipt.capture) !== canonicalJson(prepared))
        throw new Error("Capture identity mismatch.");
      return receipt
        ? { status: "succeeded", outcome: receipt.outcome }
        : { status: "unknown" };
    },
    async reconcileRecovery(prepared, outcome, id) {
      const c = await options.connect();
      try {
        const receipt = (
          await c.query<{
            input_digest: string;
            outcome: { status: "restored"; evidence: Json };
          }>(
            `SELECT input_digest,outcome FROM ${schema}.recoveries WHERE id=$1`,
            [operationKey(id)],
          )
        )[0];
        if (!receipt) return { status: "unknown" };
        if (receipt.input_digest !== hash({ prepared, outcome }))
          throw new Error("Recovery receipt input mismatch.");
        return receipt.outcome;
      } finally {
        await c.close();
      }
    },
    async recover(prepared, outcome, id) {
      const plan = prepared.plan as unknown as {
          mutation: Mutation;
          resource: string;
          operationKey: string;
        },
        m = mutation(json(plan.mutation)),
        c = await options.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          operationKey(id),
        ]);
        const inputDigest = hash({ prepared, outcome });
        const original = (
          await c.query<{ capture: Prepared; outcome: Outcome }>(
            `SELECT capture,outcome FROM ${schema}.operations WHERE id=$1`,
            [plan.operationKey],
          )
        )[0];
        if (
          !original ||
          hash({ prepared: original.capture, outcome: original.outcome }) !==
            inputDigest
        )
          throw new Error("Capture or outcome identity mismatch.");
        const receipt = (
          await c.query<{
            input_digest: string;
            outcome: { status: "restored"; evidence: Json };
          }>(
            `SELECT input_digest,outcome FROM ${schema}.recoveries WHERE id=$1`,
            [operationKey(id)],
          )
        )[0];
        if (receipt) {
          if (receipt.input_digest !== inputDigest)
            throw new Error("Recovery ID belongs to another input digest.");
          await c.query("COMMIT");
          return receipt.outcome;
        }
        const state = await inspect(c, m, true);
        if (canonicalJson(state) !== canonicalJson(outcome.evidence)) {
          await c.query("ROLLBACK");
          return {
            status: "conflict",
            evidence: json({
              resource: state.resource,
              revision: state.revision,
            }),
          };
        }
        const keys = Object.keys(m.key).sort(),
          where = keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(" AND "),
          table = tableName(m.table);
        if (prepared.before === null)
          await c.query(
            `DELETE FROM ${table} WHERE ${where}`,
            keys.map((k) => m.key[k]),
          );
        else {
          const before = prepared.before as Record<string, Json>,
            columns = Object.keys(before).sort();
          if (state.row === null)
            await c.query(
              `INSERT INTO ${table} (${columns.map(ident).join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
              columns.map((k) => before[k]),
            );
          else {
            const writable = columns.filter((k) => !keys.includes(k));
            if (writable.length)
              await c.query(
                `UPDATE ${table} SET ${writable.map((k, i) => `${ident(k)}=$${keys.length + i + 1}`).join(",")} WHERE ${where}`,
                [
                  ...keys.map((k) => m.key[k]),
                  ...writable.map((k) => before[k]),
                ],
              );
          }
        }
        const restored = await inspect(c, m);
        if (canonicalJson(restored.row) !== canonicalJson(prepared.before))
          throw new Error("Restored row did not match the capture.");
        const result = {
          status: "restored" as const,
          evidence: json(restored),
        };
        await c.query(
          `INSERT INTO ${schema}.recoveries(id,input_digest,outcome) VALUES($1,$2,$3::jsonb)`,
          [operationKey(id), inputDigest, canonicalJson(result)],
        );
        await c.query("COMMIT");
        return result;
      } catch (error) {
        await c.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        await c.close();
      }
    },
  };
}
