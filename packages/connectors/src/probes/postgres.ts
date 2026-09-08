import type { Probe, ProbeCall, ProbeExecutor, ProbeResult } from "./registry.ts";

type ForeignKeyRow = {
  readonly table_name: string;
  readonly column_name: string;
  readonly foreign_table_name: string;
  readonly foreign_column_name: string;
};

export const countProbe: Probe = {
  id: "postgres.count",
  async run(call: ProbeCall, exec: ProbeExecutor): Promise<ProbeResult> {
    try {
      const input = parsePredicateInput(call.args);
      const rows = await runQuery(exec, `SELECT COUNT(*) AS count FROM ${quoteIdent(input.table)} WHERE ${input.predicate}`);
      const radius = readCount(rows);
      return { radius, note: `predicate touches ${radius} rows in ${input.table}` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const cascadeProbe: Probe = {
  id: "postgres.cascade",
  async run(call: ProbeCall, exec: ProbeExecutor): Promise<ProbeResult> {
    try {
      const input = parsePredicateInput(call.args);
      const keys = await loadForeignKeys(exec);
      const visited = new Set<string>();
      let queue: readonly CascadeTarget[] = [{ table: input.table, predicate: input.predicate }];
      let radius = 0;
      const facts: Record<string, string> = {};
      for (let index = 0; index < queue.length; index += 1) {
        const target = queue[index]!;
        if (visited.has(target.table)) continue;
        visited.add(target.table);
        const rows = await runQuery(exec, `SELECT COUNT(*) AS count FROM ${quoteIdent(target.table)} WHERE ${target.predicate}`);
        const count = readCount(rows);
        radius += count;
        facts[`postgres.cascade.${target.table}`] = String(count);
        const children = keys.filter((key) => key.foreign_table_name === target.table);
        const next = children.map((key) => ({
          table: key.table_name,
          predicate: `EXISTS (SELECT 1 FROM ${quoteIdent(key.foreign_table_name)} parent WHERE parent.${quoteIdent(key.foreign_column_name)} = ${quoteIdent(key.table_name)}.${quoteIdent(key.column_name)} AND ${target.predicate})`,
        }));
        queue = [...queue, ...next];
      }
      return { radius, facts, note: `cascade reaches ${visited.size} tables` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

type CascadeTarget = { readonly table: string; readonly predicate: string };

function parsePredicateInput(args: Readonly<Record<string, unknown>>): { readonly table: string; readonly predicate: string } {
  const table = args.table;
  const predicate = args.predicate;
  if (typeof table !== "string" || table.length === 0) throw new Error("postgres probe requires string table");
  if (typeof predicate !== "string" || predicate.length === 0) throw new Error("postgres probe requires string predicate");
  return { table, predicate };
}

async function runQuery(exec: ProbeExecutor, statement: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
  if (exec.query === undefined) throw new Error("postgres probe requires query executor");
  return exec.query(statement);
}

async function loadForeignKeys(exec: ProbeExecutor): Promise<readonly ForeignKeyRow[]> {
  const rows = await runQuery(exec, "SELECT table_name, column_name, foreign_table_name, foreign_column_name FROM information_schema.referential_constraints");
  return rows.map((row) => ({
    table_name: readString(row, "table_name"),
    column_name: readString(row, "column_name"),
    foreign_table_name: readString(row, "foreign_table_name"),
    foreign_column_name: readString(row, "foreign_column_name"),
  }));
}

function readCount(rows: readonly Readonly<Record<string, unknown>>[]): number {
  const value = rows[0]?.count;
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(count)) throw new Error("postgres count probe returned no numeric count");
  return count;
}

function readString(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`foreign key row missing ${key}`);
  return value;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
