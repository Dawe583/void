import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { BROKEN_POLICY_DECISION, MATCH_KEYS, UNMATCHED_DECISION, isMatchKey } from "./index.ts";

describe("@void/policy", () => {
  test("an unmatched call and a broken file do not resolve the same way", () => {
    assert.equal(UNMATCHED_DECISION, "hold");
    assert.equal(BROKEN_POLICY_DECISION, "deny");
    assert.notEqual(UNMATCHED_DECISION, BROKEN_POLICY_DECISION);
  });

  test("the grammar is exactly five match keys", () => {
    assert.equal(MATCH_KEYS.length, 5);
    assert.deepEqual([...MATCH_KEYS].sort(), ["blast_radius", "class", "connector", "tool", "workspace"]);
  });

  test("a near miss on a key name is not a match key", () => {
    // The typo case is the load bearing one: blast_radus silently dropping a
    // condition widens a narrow rule to everything of that class, which in a
    // tool that gates writes means allowing what should have been held.
    assert.equal(isMatchKey("blast_radius"), true);
    assert.equal(isMatchKey("blast_radus"), false);
    assert.equal(isMatchKey("expr"), false);
  });
});
