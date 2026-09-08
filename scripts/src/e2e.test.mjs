import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

await test("e2e proxy loop", { concurrency: false, timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ["scripts/src/e2e.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, `stdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.match(stdout, /PASS api initialize version/);
  assert.match(stdout, /PASS binary observe orders_delete forwards/);
});
