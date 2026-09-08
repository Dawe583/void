
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { captureBeforeImage, listCascadeTables, type QueryExecutor } from "./capture.ts";
import { parseStatement } from "./parse.ts";

class FakeExecutor implements QueryExecutor {
  readonly queries: readonly { readonly sql: string; readonly params: readonly unknown[] }[] = [];
  private readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;

  constructor(tables: Readonly<Record<string, readonly Record<string, unknown>[]>>) {
    this.tables = tables;
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    (this.queries as { sql: string; params: readonly unknown[] }[]).push({ sql, params });
    if (sql.includes("information_schema")) return [{ table_schema: "public", table_name: "order_items" }] as T[];
    const table = sql.includes("order_items") ? "public.order_items" : "public.orders";
    return [...(this.tables[table] ?? [])] as T[];
  }
}

describe("captureBeforeImage", () => {
  test("captures update rows with the parsed predicate", async () => {
    const exec = new FakeExecutor({ "public.orders": [{ id: 1, status: "draft" }] });
    const image = await captureBeforeImage(exec, parseStatement("update public.orders set status = 'paid' where id = 1"), {
      tables: [{ table: "public.orders", primaryKey: ["id"] }],
    });
    assert.equal(image.rows.length, 1);
    assert.deepEqual(image.rows[0]?.key, { id: "1" });
    assert.match(exec.queries[0]?.sql ?? "", /where id = 1/);
  });

  test("captures delete rows and traverses cascade tables", async () => {
    const exec = new FakeExecutor({
      "public.orders": [{ id: 1, status: "draft" }],
      "public.order_items": [{ id: 10, order_id: 1, sku: "a" }],
    });
    const image = await captureBeforeImage(exec, parseStatement("delete from public.orders where id = 1"), {
      tables: [
        { table: "public.orders", primaryKey: ["id"] },
        { table: "public.order_items", primaryKey: ["id"] },
      ],
    });
    assert.deepEqual(image.cascadeTables, ["public.order_items"]);
    assert.equal(image.rows.length, 2);
    assert.deepEqual(image.rows[1]?.dependencies, ["public.orders"]);
  });

  test("lists cascade tables from information schema", async () => {
    const exec = new FakeExecutor({});
    assert.deepEqual(await listCascadeTables(exec, "public.orders"), ["public.order_items"]);
    assert.equal(exec.queries[0]?.params[0], "orders");
  });
});
