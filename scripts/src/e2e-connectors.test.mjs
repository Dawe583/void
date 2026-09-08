import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  runPostgresDrift,
  runPostgresRoundTrip,
  runReplayDryRun,
  runS3Drift,
  runS3RoundTrip,
} from "./e2e-connectors.mjs";

describe("connector e2e scenarios", () => {
  test("Postgres update restores the captured before image", async () => {
    const result = await runPostgresRoundTrip();
    assert.deepEqual(result.report.refused, []);
    assert.equal(result.reference.namespace, "e2e-pg");
  });

  test("Postgres update refuses when current data drifted", async () => {
    const report = await runPostgresDrift();
    assert.equal(report.refused[0]?.reason, "drift");
  });

  test("replay dry-run uses a real JSONL ledger and manifest", async () => {
    const result = await runReplayDryRun();
    assert.match(result.out.join("\n"), /restore-orders-1/);
  });

  test("S3 delete restores captured bytes", async () => {
    const result = await runS3RoundTrip();
    assert.deepEqual(result.report.refused, []);
  });

  test("S3 restore refuses when the object changed", async () => {
    const report = await runS3Drift();
    assert.equal(report.refused[0]?.reason, "drift");
  });
});
