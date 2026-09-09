import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const script = new URL("./bench.mjs", import.meta.url);

async function run(...args) {
  return execute(process.execPath, [script.pathname, ...args], {
    timeout: 30_000,
    // An unusable ambient key proves the benchmark does not read user keys.
    env: { ...process.env, VOID_SIGNING_KEY: "not-a-signing-key" },
  });
}

function assertMetrics(metrics) {
  assert.ok(metrics.ops > 0);
  assert.ok(Number.isFinite(metrics.ops));
  for (const key of ["p50", "p95", "p99"]) {
    assert.ok(Number.isFinite(metrics[key]), `${key} must be finite`);
    assert.ok(metrics[key] >= 0);
  }
  assert.ok(metrics.p50 <= metrics.p95);
  assert.ok(metrics.p95 <= metrics.p99);
}

test("scale 10 prints three smoke-grade scenario rows", async () => {
  const { stdout, stderr } = await run("--scale", "10");
  assert.equal(stderr, "");
  assert.match(stdout, /smoke-grade.*this machine/i);
  assert.match(stdout, /ops\/sec.*p50.*p95.*p99/);
  const rows = stdout.split("\n").filter((line) => /^(forward|ledger-append|classify)\s/.test(line));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((line) => line.split(/\s+/)[0]), ["forward", "ledger-append", "classify"]);
  for (const row of rows) {
    const [, ops, p50, p95, p99] = row.trim().split(/\s+/);
    assertMetrics({ ops: Number(ops), p50: Number(p50), p95: Number(p95), p99: Number(p99) });
  }
  assert.match(stdout, /serialization probe/);
});

test("JSON reports completed work, latency units and serialization probe", async () => {
  const { stdout, stderr } = await run("--json", "--scale", "10");
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);
  assert.equal(report.scale, 10);
  assert.equal(report.smokeGrade, true);
  assert.equal(report.latencyUnit, "ms");
  assert.equal(report.throughputUnit, "ops/sec");
  assert.ok(report.registryEntries >= 163);
  assert.deepEqual(report.scenarios.map((row) => row.name), ["forward", "ledger-append", "classify"]);
  assert.deepEqual(report.scenarios.map((row) => row.count), [10, 10, 1000]);
  for (const scenario of report.scenarios) assertMetrics(scenario);
  const [forward, ledger, classify] = report.scenarios;
  assert.equal(forward.responses, 10);
  assert.equal(forward.ledgerEntries, 20);
  assert.equal(ledger.ledgerEntries, 10);
  assertMetrics(ledger.serialization);
  assert.equal(ledger.serialization.count, 10);
  assert.ok(ledger.serialization.bytes > 0);
  assert.equal(Object.values(classify.outcomes).reduce((sum, count) => sum + count, 0), 1000);
  assert.equal(classify.outcomes["unknown-tool"] ?? 0, 0);
});

test("invalid scales and unknown flags fail before benchmarking", async () => {
  for (const args of [["--scale", "0"], ["--scale", "-1"], ["--scale", "1.5"], ["--scale"], ["--scale", "NaN"], ["--unknown"]]) {
    await assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Usage:/);
      assert.equal(error.stdout, "");
      return true;
    });
  }
});
