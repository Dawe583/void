
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { BeforeImage, CapturedRow, QueryExecutor } from "./capture.ts";
import { buildDriftReport, buildInverse } from "./inverse.ts";
import { parseStatement } from "./parse.ts";
import { applyInverse, type ReplayExecutor } from "./replay.ts";

class MemoryExecutor implements ReplayExecutor {
  began = false;
  committed = false;
  rolledBack = false;

  readonly tables: Record<string, Record<string, unknown>[]>;

  constructor(tables: Record<string, Record<string, unknown>[]>) {
    this.tables = tables;
  }

  async begin(): Promise<void> { this.began = true; }
  async commit(): Promise<void> { this.committed = true; }
  async rollback(): Promise<void> { this.rolledBack = true; }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const table = tableFromSql(sql);
    if (sql.startsWith("select")) {
      const [key] = params;
      return (this.tables[table] ?? []).filter((row) => String(row.id) === String(key)) as T[];
    }
    if (sql.startsWith("update")) {
      const rows = this.tables[table] ?? [];
      const id = params.at(-1);
      const target = rows.find((row) => String(row.id) === String(id));
      if (target !== undefined) {
        const setClause = sql.slice(sql.indexOf(" set "), sql.indexOf(" where "));
        const columns = [...setClause.matchAll(/"([^"]+)" = \$/g)].map((match) => match[1]).filter((column): column is string => column !== undefined);
        columns.forEach((column, index) => { target[column] = params[index]; });
      }
      return [] as T[];
    }
    if (sql.startsWith("insert")) {
      const columns = [...sql.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((column): column is string => column !== undefined).slice(1);
      const row: Record<string, unknown> = {};
      columns.forEach((column, index) => { row[column] = params[index]; });
      (this.tables[table] ??= []).push(row);
      return [] as T[];
    }
    return [] as T[];
  }
}

describe("inverse and replay", () => {
  test("builds update steps and restores changed rows", async () => {
    const image = beforeImage("update public.orders set status = 'paid' where id = 1", [row("public.orders", { id: 1 }, { id: 1, status: "draft" })]);
    const steps = buildInverse(image.statement, image);
    const exec = new MemoryExecutor({ "public.orders": [{ id: 1, status: "paid" }] });
    const report = await applyInverse(exec, steps, image);
    assert.deepEqual(report.refused, []);
    assert.deepEqual(exec.tables["public.orders"], [{ id: 1, status: "draft" }]);
    assert.equal(exec.began, true);
    assert.equal(exec.committed, true);
  });

  test("builds parent inserts before child rows", () => {
    const image = beforeImage("delete from public.orders where id = 1", [
      row("public.orders", { id: 1 }, { id: 1, status: "draft" }),
      row("public.order_items", { id: 10 }, { id: 10, order_id: 1 }, ["public.orders"]),
    ]);
    const steps = buildInverse(image.statement, image);
    assert.equal(steps[0]?.table, "public.orders");
    assert.equal(steps[0]?.operation, "insert");
    assert.equal(steps[1]?.table, "public.order_items");
  });

  test("replay refuses when drift changed a captured field", async () => {
    const image = beforeImage("update public.orders set status = 'paid' where id = 1", [row("public.orders", { id: 1 }, { id: 1, status: "draft" })]);
    const exec = new MemoryExecutor({ "public.orders": [{ id: 1, status: "human" }] });
    const report = await applyInverse(exec, buildInverse(image.statement, image), image);
    assert.equal(report.refused[0]?.reason, "drift");
    assert.match(report.refused[0]?.report ?? "", /status changed/);
    assert.deepEqual(exec.tables["public.orders"], [{ id: 1, status: "human" }]);
    assert.equal(exec.rolledBack, true);
  });

  test("drift report names missing rows", () => {
    const image = beforeImage("delete from public.orders where id = 1", [row("public.orders", { id: 1 }, { id: 1 })]);
    const report = buildDriftReport(image, []);
    assert.equal(report.drifted, true);
    assert.match(report.report, /public.orders id=1 is missing/);
  });
});

function beforeImage(sql: string, rows: readonly CapturedRow[]): BeforeImage {
  return { statement: parseStatement(sql), rows, cascadeTables: [], capturedAt: new Date(0).toISOString() };
}

function row(table: string, key: Readonly<Record<string, string | number>>, data: Readonly<Record<string, unknown>>, dependencies: readonly string[] = []): CapturedRow {
  const stringKey = Object.fromEntries(Object.entries(key).map(([name, value]) => [name, String(value)]));
  return { table, key: stringKey, row: data, dependencies };
}

function tableFromSql(sql: string): string {
  const match = /"public"\."([^"]+)"/.exec(sql);
  if (match === null) throw new Error(`missing table in ${sql}`);
  return `public.${match[1]}`;
}
