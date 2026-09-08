import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { fallbackBlastRadius, pickProbes } from "./registry.ts";

describe("probe registry", () => {
  test("picks probes by connector", () => {
    assert.deepEqual(pickProbes("postgres").map((probe) => probe.id), ["postgres.count", "postgres.cascade"]);
    assert.deepEqual(pickProbes("s3").map((probe) => probe.id), ["s3.object_count", "s3.versioning"]);
  });

  test("unknown connector has no probes and keeps the args fallback contract", () => {
    assert.deepEqual(pickProbes("stripe"), []);
    assert.equal(fallbackBlastRadius({ rows: 12 }), 12);
    assert.equal(fallbackBlastRadius({ count: 7 }), 7);
    assert.equal(fallbackBlastRadius({ limit: 4 }), 4);
    assert.equal(fallbackBlastRadius({ n: 2 }), 2);
    assert.equal(fallbackBlastRadius({ rows: "12" }), undefined);
  });
});
