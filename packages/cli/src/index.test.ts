import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { parseInvocation } from "./index.ts";

describe("@void/cli", () => {
  test("parses a command and keeps the rest of argv intact", () => {
    const parsed = parseInvocation(["ledger", "verify", "--workspace", "demo"]);
    assert.deepEqual(parsed, {
      ok: true,
      command: "ledger",
      args: ["verify", "--workspace", "demo"],
    });
  });

  test("an unknown command is refused and the refusal names the alternatives", () => {
    // Standards rule 10: a generic error teaches the caller to reword and try
    // again. Naming what was expected is the cheapest version of that rule.
    const parsed = parseInvocation(["verfiy"]);
    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /unknown command "verfiy".*run, classify, feed, watch, approvals, ledger, replay, policy, export, attest, taint, verify/,
    );
  });

  test("no arguments is a usage line, not a crash", () => {
    const parsed = parseInvocation([]);
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /^usage: void /);
  });
});
