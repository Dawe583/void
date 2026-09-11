
import { createHash } from "node:crypto";

import type { BeforeImage, CapturedRow, QueryExecutor } from "./capture.ts";

export type InverseOperation = "update" | "insert";

export type InverseStep = {
  readonly id: string;
  readonly table: string;
  readonly operation: InverseOperation;
  readonly key: Readonly<Record<string, string>>;
  readonly row: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
  readonly inputDigest: `sha256:${string}`;
};

export type DriftReport = {
  readonly drifted: boolean;
  readonly report: string;
};

export function buildInverse(statement: BeforeImage["statement"], image: BeforeImage): InverseStep[] {
  const orderedRows: CapturedRow[] = [];
  const remaining = [...image.rows];
  while (remaining.length) {
    const index = remaining.findIndex(row => row.dependencies.every(table => !remaining.some(candidate => candidate.table === table)));
    if (index < 0) throw new Error("cyclic snapshot dependencies cannot be replayed");
    orderedRows.push(remaining.splice(index, 1)[0]!);
  }
  return orderedRows.map((row, index) => ({
    id: `${statement.type}-${index}-${row.table}`,
    table: row.table,
    operation: statement.type === "delete" ? "insert" : "update",
    key: row.key,
    row: row.row,
    dependsOn: row.dependencies,
    inputDigest: digestJson(row.row),
  }));
}

export function buildDriftReport(image: BeforeImage, currentRows: readonly CapturedRow[]): DriftReport {
  const currentByKey = new Map(currentRows.map((row) => [rowIdentity(row), row]));
  const changes: string[] = [];

  for (const captured of image.rows) {
    const current = currentByKey.get(rowIdentity(captured));
    if (current === undefined) {
      changes.push(`${captured.table} ${formatKey(captured.key)} is missing`);
      continue;
    }
    const columns = new Set([...Object.keys(captured.row), ...Object.keys(current.row)]);
    for (const column of columns) {
      if (digestJson(captured.row[column]) !== digestJson(current.row[column])) {
        changes.push(`${captured.table} ${formatKey(captured.key)} column ${column} changed`);
      }
    }
  }

  return changes.length === 0
    ? { drifted: false, report: "no drift" }
    : { drifted: true, report: changes.join("; ") };
}

export async function currentRowsForImage(exec: QueryExecutor, image: BeforeImage): Promise<CapturedRow[]> {
  const rows: CapturedRow[] = [];
  for (const row of image.rows) {
    const where = Object.keys(row.key).map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(" and ");
    const values = Object.values(row.key);
    const found = await exec.query<Record<string, unknown>>(`select * from ${quoteIdentifierPath(row.table)} where ${where} for update`, values);
    rows.push(...found.map((current) => ({ table: row.table, key: row.key, row: current, dependencies: row.dependencies })));
  }
  return rows;
}

export function updateSql(step: InverseStep): { readonly sql: string; readonly params: readonly unknown[] } {
  const columns = Object.keys(step.row).filter((column) => !(column in step.key));
  const assignments = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`);
  const where = Object.keys(step.key).map((column, index) => `${quoteIdentifier(column)} = $${columns.length + index + 1}`);
  return {
    sql: `update ${quoteIdentifierPath(step.table)} set ${assignments.join(", ")} where ${where.join(" and ")}`,
    params: [...columns.map((column) => step.row[column]), ...Object.values(step.key)],
  };
}

export function insertSql(step: InverseStep): { readonly sql: string; readonly params: readonly unknown[] } {
  const columns = Object.keys(step.row);
  const params = columns.map((_, index) => `$${index + 1}`);
  return {
    sql: `insert into ${quoteIdentifierPath(step.table)} (${columns.map(quoteIdentifier).join(", ")}) overriding system value values (${params.join(", ")})`,
    params: columns.map((column) => step.row[column]),
  };
}

function rowIdentity(row: CapturedRow): string {
  return `${row.table}:${JSON.stringify(row.key)}`;
}

function formatKey(key: Readonly<Record<string, string>>): string {
  return Object.entries(key).map(([name, value]) => `${name}=${value}`).join(",");
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteIdentifierPath(path: string): string {
  return path.split(".").map(quoteIdentifier).join(".");
}
