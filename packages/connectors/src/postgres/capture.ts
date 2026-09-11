
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
  const rows = await selectRows(exec, statement, targetSchema, []);
  const cascadeTables: string[] = [];
  if (statement.type === "delete") {
    const pending: { table: string; rows: readonly CapturedRow[]; ancestors: readonly string[] }[] = [{ table: targetSchema.table, rows: [...rows], ancestors: [] }];
    const seen = new Set(rows.map(row => `${row.table}:${JSON.stringify(row.key)}`));
    for (let i = 0; i < pending.length; i++) {
      if (pending.length > 100) throw new Error("cascade traversal exceeds the supported table limit");
      const parent = pending[i]!;
      for (const edge of await cascadeEdges(exec, parent.table)) {
        if (parent.ancestors.includes(edge.table) || edge.table === parent.table) throw new Error("cyclic cascade cannot be captured safely");
        const childSchema = findSchema(schema, edge.table);
        if (!cascadeTables.includes(edge.table)) cascadeTables.push(edge.table);
        const children: CapturedRow[] = [];
        for (const row of parent.rows) {
          const values = edge.parentColumns.map(column => row.row[column]);
          if (values.some(value => value === undefined)) throw new Error("cascade parent column was not captured");
          const predicate = edge.childColumns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(" and ");
          const matches = await exec.query<Record<string, unknown>>(`select * from ${quoteIdentifierPath(edge.table)} where ${predicate}`, values);
          for (const match of matches) {
            const child = { table: edge.table, key: rowKey(match, childSchema.primaryKey), row: match, dependencies: [parent.table] };
            const identity = `${child.table}:${JSON.stringify(child.key)}`;
            if (!seen.has(identity)) { seen.add(identity); children.push(child); rows.push(child); }
            else {
              const index = rows.findIndex(existing => `${existing.table}:${JSON.stringify(existing.key)}` === identity);
              const existing = rows[index]!;
              rows[index] = { ...existing, dependencies: [...new Set([...existing.dependencies, parent.table])] };
            }
          }
        }
        if (children.length) pending.push({ table: edge.table, rows: children, ancestors: [...parent.ancestors, parent.table] });
      }
    }
  }
  return { statement, rows, cascadeTables, capturedAt: new Date().toISOString() };
}

type CascadeEdge = { readonly table: string; readonly childColumns: readonly string[]; readonly parentColumns: readonly string[] };

async function cascadeEdges(exec: QueryExecutor, table: string): Promise<readonly CascadeEdge[]> {
  // pg_constraint preserves column pairing for composite foreign keys. Reusing
  // the parent's WHERE on the child captured unrelated rows with different ids.
  return exec.query<CascadeEdge>(`
    select ns.nspname || '.' || child.relname as "table",
      array_agg(ca.attname order by keys.ordinality) as "childColumns",
      array_agg(pa.attname order by keys.ordinality) as "parentColumns"
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    cross join lateral unnest(c.conkey, c.confkey) with ordinality as keys(childkey, parentkey, ordinality)
    join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = keys.childkey
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = keys.parentkey
    where c.contype = 'f' and c.confdeltype = 'c' and c.confrelid = $1::regclass
    group by c.oid, ns.nspname, child.relname
    order by ns.nspname, child.relname`, [table]);
}

export async function listCascadeTables(exec: QueryExecutor, table: string): Promise<string[]> {
  return (await cascadeEdges(exec, table)).map(edge => edge.table);
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

function quoteIdentifier(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
