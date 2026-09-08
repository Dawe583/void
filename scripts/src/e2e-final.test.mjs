import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = new URL("./e2e-final.mjs", import.meta.url);
const root = new URL("../..", import.meta.url);

describe("final e2e sweep", () => {
  test("runs the product moments through the script", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [script.pathname, "all"],
      { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 },
    );

    assert.equal(stderr, "");
    assert.match(stdout, /PASS full product stdio moment/);
    assert.match(stdout, /PASS attestation moment/);
    assert.match(stdout, /PASS tamper moment/);
    assert.match(stdout, /PASS feed moment/);
    assert.doesNotMatch(stdout, /FAIL /);
    assert.match(stdout, /^(PASS|NOTE) /m);
  });
});
