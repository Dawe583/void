
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { ParseError, parseStatement } from "./parse.ts";

describe("parseStatement", () => {
  const cases = [
    { sql: "update users set name = 'a' where id = 1", type: "update", table: "users", predicate: "id = 1", returning: false },
    { sql: "update users set name = 'a' where id = 1 returning *", type: "update", table: "users", predicate: "id = 1", returning: true },
    { sql: "update users u set name = 'a' from teams t where u.team_id = t.id", type: "update", table: "users", predicate: "u.team_id = t.id", returning: false },
    { sql: "delete from orders where id in (select order_id from items where qty > 1)", type: "delete", table: "orders", predicate: "id IN (SELECT order_id FROM items WHERE qty > 1)", returning: false },
    { sql: "delete from orders where exists (select 1 from items where items.order_id = orders.id)", type: "delete", table: "orders", predicate: "exists(SELECT 1 FROM items WHERE items.order_id = orders.id)", returning: false },
    { sql: "delete from orders where id = 4 returning id", type: "delete", table: "orders", predicate: "id = 4", returning: true },
    { sql: "insert into users(id, name) values (1, 'a')", type: "insert", table: "users", predicate: null, returning: false },
    { sql: "insert into users(id, name) values (1, 'a') returning id", type: "insert", table: "users", predicate: null, returning: true },
    { sql: "truncate table users", type: "truncate", table: "users", predicate: null, returning: false },
    { sql: "drop table users", type: "drop", table: "users", predicate: null, returning: false },
    { sql: "select * from users where id = 1", type: "other", table: "users", predicate: "id = 1", returning: false },
    { sql: "update public.users set name = 'a' where public.users.id = 1", type: "update", table: "public.users", predicate: "public.users.id = 1", returning: false },
  ] as const;

  for (const expected of cases) {
    test(expected.sql, () => {
      const parsed = parseStatement(expected.sql);
      assert.equal(parsed.type, expected.type);
      assert.equal(parsed.tables[0], expected.table);
      assert.equal(parsed.predicate, expected.predicate);
      assert.equal(parsed.returning, expected.returning);
    });
  }

  test("malformed sql throws a typed parse error", () => {
    assert.throws(() => parseStatement("update set where"), (error) => error instanceof ParseError && error.kind === "ParseFailed");
  });
});
