import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  REGISTRY_DISCLAIMER,
  registry,
  registryStats,
  worstCase,
  validatePrecondition,
} from "./index.ts";

describe("@void/registry", () => {
  test("re-exports the expanded registry entries", () => {
    // The re-export is the whole package today, so the test that matters is
    // that it reaches the real data rather than an empty module.
    assert.equal(registry.length, 163);
    assert.equal(registryStats().entries, registry.length);
  });

  test("every entry ends with an unguarded fallback case", () => {
    // The premise of the registry: a class is a property of a call evaluated
    // against the state of its target, so an entry is an ordered list of
    // guarded cases. Without a terminal unguarded case an evaluator has no
    // answer for a target whose configuration is unknown, and policy would
    // then have nothing to fall back to.
    for (const entry of registry) {
      const last = entry.cases.at(-1);
      assert.ok(last, `${entry.id} has no cases`);
      assert.equal(last.when, "always", `${entry.id} does not end with an unguarded case`);
    }
  });

  test("a structured case is a valid precondition and fallbacks are always-kind", () => {
    // The migration contract: every structured guard passes the closed
    // grammar's own validator, and the only structured form a fallback case
    // may take is the terminal always kind, so a case that is meant to be
    // terminal cannot smuggle in a narrower condition.
    for (const entry of registry) {
      entry.cases.forEach((item, index) => {
        if (item.if === undefined) return;
        const errors = validatePrecondition(item.if, `${entry.id}.cases[${index}].if`);
        assert.deepEqual(errors, [], `${entry.id} case ${index}: ${errors.join("; ")}`);
        if (item.when === "always")
          assert.deepEqual(item.if, { kind: "always" }, `${entry.id} case ${index}: fallback must be always`);
      });
    }
  });

  test("ids are unique, because policy rules match on them", () => {
    const ids = new Set(registry.map((entry) => entry.id));
    assert.equal(ids.size, registry.length);
  });

  test("the disclaimer travels with the data", () => {
    // Standards rule 10: that label is the only thing between an illustrative
    // classification and a false assurance, so it ships with the stats payload
    // rather than only on the page that renders it.
    assert.equal(registryStats().disclaimer, REGISTRY_DISCLAIMER);
  });

  test("worst case is the class policy must assume", () => {
    const conditional = registry.find((entry) => new Set(entry.cases.map((item) => item.tone)).size > 1);
    assert.ok(conditional, "expected at least one entry whose class depends on configuration");
    const ranks = { r0: 0, r1: 1, r2: 2, r3: 3 };
    for (const item of conditional.cases) {
      assert.ok(ranks[worstCase(conditional)] >= ranks[item.tone]);
    }
  });
});
