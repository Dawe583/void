import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { assertUniqueIds, findConnector, type Connector } from "./index.ts";

const postgres: Connector = { id: "postgres", surface: "postgres.row" };
const s3: Connector = { id: "s3", surface: "aws.s3.object" };

describe("@void/connectors", () => {
  test("resolves by id from the list it is handed", () => {
    assert.equal(findConnector([postgres, s3], "s3"), s3);
  });

  test("an unknown id resolves to nothing, so the caller has to decide", () => {
    // The proxy fails closed on this, which is why the answer is undefined
    // rather than a permissive default connector.
    assert.equal(findConnector([postgres], "stripe"), undefined);
    assert.equal(findConnector([], "postgres"), undefined);
  });

  test("duplicate ids are refused", () => {
    assert.throws(() => assertUniqueIds([postgres, { id: "postgres", surface: "other" }]), /duplicate connector id/);
    assert.doesNotThrow(() => assertUniqueIds([postgres, s3]));
  });
});
