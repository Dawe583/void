import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("connector README contract", () => {
  test("stays within the assigned design size and forbidden punctuation rule", () => {
    const lines = readme.split("\n");
    assert.ok(lines.length >= 200, `expected at least 200 lines, got ${lines.length}`);
    assert.ok(lines.length <= 350, `expected at most 350 lines, got ${lines.length}`);
    assert.equal(/[\u2013\u2014]/u.test(readme), false);
  });

  test("freezes the Connector and SnapshotStore surfaces", () => {
    assert.match(readme, /export type Connector = \{/);
    assert.match(readme, /classify: \(call: ConnectorCall\) => Promise<ClassifiedCallFacts>/);
    assert.match(readme, /capture: \(call: ConnectorCall\) => Promise<CaptureResult>/);
    assert.match(readme, /inverse: \(capture: SnapshotReference\) => Promise<InversePlan>/);
    assert.match(readme, /apply: \(plan: InversePlan\) => Promise<ApplyReport>/);
    assert.match(readme, /export type SnapshotStore = \{/);
    assert.match(readme, /delete-by-age hook/);
    assert.match(readme, /RedactionHook/);
  });

  test("names fail-closed errors, facts, and module requirements", () => {
    for (const required of [
      "CaptureFailed",
      "InverseImpossible",
      "node-sql-parser",
      "pg.capture.before_image",
      "pg.cascade.traversed",
      "s3.key.existed",
      "bucket.versioning",
      "information_schema",
      "replay refuses",
    ]) {
      assert.ok(readme.includes(required), `missing ${required}`);
    }
  });
});
