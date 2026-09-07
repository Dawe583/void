/**
 * Runs every package test suite and refuses to report green on a suite that ran
 * nothing.
 *
 * `node --test` exits 0 when it finds no test files, so `pnpm -r run test` would
 * pass for a package whose tests were deleted, renamed out of the glob, or never
 * written. The first exit criterion of every work package is "the tests pass",
 * and that criterion is only honest if a suite of zero is a failure.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..", "..");
const packagesDir = join(root, "packages");

if (!existsSync(packagesDir)) {
  console.error("no packages/ directory, nothing to check");
  process.exit(1);
}

const results = [];

for (const name of readdirSync(packagesDir).sort()) {
  const dir = join(packagesDir, name);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.scripts?.test) continue;

  // TAP, not the runtime's default reporter: the default switched from
  // machine readable lines to a human spec format in Node 23, which broke the
  // counts this script parses. Asking for TAP keeps the output a contract on
  // every engine version the workspace may run on.
  const run = spawnSync("node", ["--test", "--test-reporter=tap"], {
    cwd: dir,
    encoding: "utf8",
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const read = (key) =>
    Number.parseInt(
      output.match(new RegExp(`^# ${key} (\\d+)$`, "m"))?.[1] ?? "-1",
      10,
    );

  results.push({
    name,
    pass: read("pass"),
    fail: read("fail"),
    code: run.status ?? 1,
    output,
  });
}

let failed = false;
const width = Math.max(...results.map((r) => r.name.length), 7);

for (const r of results) {
  const reasons = [];
  if (r.code !== 0) reasons.push(`exit ${r.code}`);
  if (r.fail > 0) reasons.push(`${r.fail} failing`);
  if (r.pass <= 0) reasons.push("ran no tests");

  console.log(
    `  ${r.name.padEnd(width)}  ${String(r.pass).padStart(3)} pass  ${String(r.fail).padStart(3)} fail  ${reasons.length ? "FAIL: " + reasons.join(", ") : "ok"}`,
  );
  if (reasons.length) {
    failed = true;
    console.log(
      r.output
        .split("\n")
        .filter((l) => l.startsWith("not ok") || l.includes("Error"))
        .slice(0, 8)
        .map((l) => `      ${l}`)
        .join("\n"),
    );
  }
}

const total = results.reduce((sum, r) => sum + Math.max(r.pass, 0), 0);
console.log(`\n  ${results.length} packages, ${total} tests`);

if (results.length === 0) {
  console.error("  no package declared a test script");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
