import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moment = new URL("./moment.mjs", import.meta.url);

async function runMoment(...args) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [moment.pathname, ...args],
    { cwd: new URL("../..", import.meta.url), timeout: 5000 },
  );
  assert.equal(stderr, "");
  return stdout;
}

describe("moment runner", () => {
  test("prints denied and approved moments", async () => {
    const stdout = await runMoment();

    assert.match(stdout, /moment: postgres delete denied/);
    assert.match(stdout, /cancelled by cli/);
    assert.match(stdout, /orders unchanged: 41883 rows/);
    assert.match(stdout, /moment: postgres delete approved/);
    assert.match(stdout, /approved by cli/);
    assert.match(stdout, /forwarded/);
    assert.match(stdout, /simulated result: 2 rows deleted/);
    assert.equal(stdout.match(/ledger records: 2/g)?.length, 2);
  });

  test("prints approval frames for a pending then resolved hold", async () => {
    const stdout = await runMoment("--tui");
    const secondHeader = stdout.indexOf("\n\nVOID APPROVALS", 1);
    const frames = [
      stdout.slice(0, secondHeader),
      stdout.slice(secondHeader + 2),
    ];

    assert.notEqual(secondHeader, -1);
    assert.match(frames[0], /VOID APPROVALS/);
    assert.match(frames[0], /postgres\.row\.delete/);
    assert.match(frames[0], /02:00/);
    assert.match(frames[1], /No held calls\./);
  });
});
