import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { cascadeProbe, countProbe } from "./postgres.ts";
import type { ProbeExecutor } from "./registry.ts";

describe("postgres probes", () => {
  test("count probe returns radius and note from a fake executor", async () => {
    const statements: string[] = [];
    const exec: ProbeExecutor = {
      async query(statement) {
        statements.push(statement);
        return [{ count: 41 }];
      },
    };

    const result = await countProbe.run({ tool: "postgres.row.delete", args: { table: "users", predicate: "active = false" } }, exec);

    assert.deepEqual(result, { radius: 41, note: "predicate touches 41 rows in users" });
    assert.equal(statements[0], 'SELECT COUNT(*) AS count FROM "users" WHERE active = false');
  });

  test("cascade probe walks fake information_schema rows", async () => {
    const exec: ProbeExecutor = {
      async query(statement) {
        if (statement.includes("information_schema.referential_constraints")) {
          return [
            { table_name: "order_items", column_name: "order_id", foreign_table_name: "orders", foreign_column_name: "id" },
            { table_name: "shipments", column_name: "order_id", foreign_table_name: "orders", foreign_column_name: "id" },
          ];
        }
        if (statement.startsWith('SELECT COUNT(*) AS count FROM "orders"')) return [{ count: 2 }];
        if (statement.startsWith('SELECT COUNT(*) AS count FROM "order_items"')) return [{ count: 5 }];
        if (statement.startsWith('SELECT COUNT(*) AS count FROM "shipments"')) return [{ count: 3 }];
        return [{ count: 0 }];
      },
    };

    const result = await cascadeProbe.run({ tool: "postgres.row.delete", args: { table: "orders", predicate: "id = 10" } }, exec);

    assert.deepEqual(result, {
      radius: 10,
      facts: {
        "postgres.cascade.orders": "2",
        "postgres.cascade.order_items": "5",
        "postgres.cascade.shipments": "3",
      },
      note: "cascade reaches 3 tables",
    });
  });

  test("probe errors surface as results", async () => {
    const result = await countProbe.run({ tool: "postgres.row.delete", args: { table: "users" } }, {});

    assert.deepEqual(result, { error: "postgres probe requires string predicate" });
  });
});
