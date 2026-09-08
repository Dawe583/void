import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const writtenFiles = [
  "README.md",
  "CHANGELOG.md",
  "docs/OPERATIONS.md",
  "docs/SDK.md",
  "packages/sdk/README.md",
];

test("release docs avoid forbidden dash characters", () => {
  for (const file of writtenFiles) {
    const text = readFileSync(file, "utf8");
    assert.equal(/[\u2013\u2014]/u.test(text), false, file);
  }
});

test("SDK docs match the public barrel", () => {
  const barrel = readFileSync("packages/sdk/src/index.ts", "utf8");
  const docs = readFileSync("docs/SDK.md", "utf8");
  for (const name of [
    "VoidClient",
    "createVoidClient",
    "holdHandle",
    "HoldDeniedError",
    "LedgerVerifyError",
    "PolicyStartupError",
    "RefusedError",
    "McpLikeClient",
    "VoidClientOptions",
    "VoidClock",
    "VoidConnect",
    "HoldHandle",
    "HoldHandleOptions",
    "RefusalReason",
    "VoidErrorCode",
  ]) {
    assert.match(barrel, new RegExp(`\\b${name}\\b`), name);
    assert.match(docs, new RegExp(`\\b${name}\\b`), name);
  }
  assert.doesNotMatch(docs, /ApplyReportLike|ReplayRefusalLike/);
});

test("changelog stays user facing", () => {
  const text = readFileSync("CHANGELOG.md", "utf8");
  assert.doesNotMatch(text, /WP-[0-9]/);
  assert.doesNotMatch(text, /packages\//);
  assert.doesNotMatch(text, /docs\//);
  assert.doesNotMatch(text, / tests?\b/i);
});
