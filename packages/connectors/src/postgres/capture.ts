
import type { ParsedStatement } from "./parse.ts";

export type QueryExecutor = {
  readonly query: <T>(sql: string, params?: readonly unknown[]) => Promise<T[]>;
};

export type TableSchema = {
  readonly table: string;
  readonly primaryKey: readonly string[];
  readonly columns?: readonly string[];
};

export type CaptureSchema = {
  readonly tables: readonly TableSchema[];
};

export type CapturedRow = {
  readonly table: string;
  readonly key: Readonly<Record<string, string>>;
  readonly row: Readonly<Record<string, unknown>>;
  readonly dependencies: readonly string[];
};

export type BeforeImage = {
  readonly statement: ParsedStatement;
  readonly rows: readonly CapturedRow[];
  readonly cascadeTables: readonly string[];
  readonly capturedAt: string;
};

type CascadeRow = { readonly table_schema?: string; readonly table_name: string };

export async function captureBeforeImage(
  exec: QueryExecutor,
  statement: ParsedStatement,
  schema: CaptureSchema,
): Promise<BeforeImage> {
  const target = statement.tables[0];
  if (target === undefined || (statement.type !== "update" && statement.type !== "delete")) {
    return { statement, rows: [], cascadeTables: [], capturedAt: new Date().toISOString() };
  }

  const targetSchema = findSchema(schema, target);
  const cascadeTables = statement.type === "delete" ? await listCascadeTables(exec, target) : [];
  const rows = await selectRows(exec, statement, targetSchema, []);

  for (const cascadeTable of cascadeTables) {
    const childSchema = schema.tables.find((item) => item.table === cascadeTable || item.table.endsWith(`.${cascadeTable}`));
    if (childSchema !== undefined) {
      rows.push(...await selectRows(exec, { ...statement, tables: [cascadeTable] }, childSchema, [target]));
    }
  }

  return { statement, rows, cascadeTables, capturedAt: new Date().toISOString() };
}

export async function listCascadeTables(exec: QueryExecutor, table: string): Promise<string[]> {
  const sql = [
    "select ccu.table_schema, ccu.table_name",
    "from information_schema.table_constraints tc",
    "join information_schema.referential_constraints rc on rc.constraint_schema = tc.constraint_schema and rc.constraint_name = tc.constraint_name",
    "join information_schema.constraint_column_usage ccu on ccu.constraint_schema = rc.unique_constraint_schema and ccu.constraint_name = rc.unique_constraint_name",
    "where tc.constraint_type = 'FOREIGN KEY' and rc.delete_rule = 'CASCADE' and ccu.table_name = $1",
  ].join(" ");
  const rows = await exec.query<CascadeRow>(sql, [unqualified(table)]);
  return rows.map((row) => row.table_schema === undefined ? row.table_name : `${row.table_schema}.${row.table_name}`);
}

async function selectRows(
  exec: QueryExecutor,
  statement: ParsedStatement,
  tableSchema: TableSchema,
  dependencies: readonly string[],
): Promise<CapturedRow[]> {
  const sql = statement.predicate === null
    ? `select * from ${quoteIdentifierPath(tableSchema.table)}`
    : `select * from ${quoteIdentifierPath(tableSchema.table)} where ${statement.predicate}`;
  const rows = await exec.query<Record<string, unknown>>(sql);
  return rows.map((row) => ({ table: tableSchema.table, key: rowKey(row, tableSchema.primaryKey), row, dependencies }));
}

function findSchema(schema: CaptureSchema, table: string): TableSchema {
  const found = schema.tables.find((item) => item.table === table || item.table.endsWith(`.${table}`));
  if (found === undefined) throw new Error(`missing schema for table ${table}`);
  if (found.primaryKey.length === 0) throw new Error(`missing primary key for table ${table}`);
  return found;
}

function rowKey(row: Readonly<Record<string, unknown>>, primaryKey: readonly string[]): Readonly<Record<string, string>> {
  const key: Record<string, string> = {};
  for (const column of primaryKey) {
    const value = row[column];
    if (value === undefined || value === null) throw new Error(`missing primary key value ${column}`);
    key[column] = String(value);
  }
  return key;
}

function quoteIdentifierPath(path: string): string {
  return path.split(".").map((part) => `"${part.replaceAll('"', '""')}"`).join(".");
}

function unqualified(table: string): string {
  return table.split(".").at(-1) ?? table;
}
