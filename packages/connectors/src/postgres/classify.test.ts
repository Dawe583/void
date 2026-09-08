
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { connectorFacts } from "./classify.ts";
import type { BeforeImage } from "./capture.ts";
import { parseStatement } from "./parse.ts";

describe("connectorFacts", () => {
  test("emits postgres registry facts as strings", () => {
    const statement = parseStatement("delete from public.orders where id = 1");
    const image: BeforeImage = {
      statement,
      rows: [{ table: "public.orders", key: { id: "1" }, row: { id: 1 }, dependencies: [] }],
      cascadeTables: ["public.order_items"],
      capturedAt: new Date(0).toISOString(),
    };
    assert.deepEqual(connectorFacts(statement, image), {
      "pg.capture.before_image": "true",
      "pg.cascade.traversed": "true",
    });
  });
});
