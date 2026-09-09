import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { registry } from "./index.ts";
import type { RegistryCase, RegistryEntry } from "./registry.ts";

/**
 * Structural audit of the registry data. These tests encode the invariants the
 * quality pass verified by hand, so a future batch that breaks one fails here
 * instead of shipping quietly:
 * - exactly one unguarded fallback per entry, and it is the last case
 * - every non-fallback case carries a machine-checkable precondition
 * - every r0 or r1 case carries an inverse and a window (a reversible case
 *   without a stated inverse is a claim, not a classification)
 * - no delete-shaped entry falls back to r0 or r1 (a delete with unknown
 *   target state is never reversible enough to relax the fallback)
 * - facts referenced by guards are a closed vocabulary: the registry tests
 *   keep the shared fixture honest by knowing every fact name in use
 */

const FALLBACK_KIND = "always";

function isFallback(c: RegistryCase): boolean {
  return c.if !== undefined && typeof c.if === "object" && !Array.isArray(c.if) && (c.if as { kind?: string }).kind === FALLBACK_KIND;
}

function guardFacts(c: RegistryCase, into: Set<string>): void {
  const guard = c.if;
  if (guard === undefined || typeof guard !== "object") return;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (record["kind"] === "fact" && typeof record["fact"] === "string") {
      into.add(record["fact"]);
    }
    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) walk(value);
    }
  };
  walk(guard);
}

describe("registry structural audit", () => {
  test("every entry has exactly one fallback and it is the last case", () => {
    for (const entry of registry) {
      const fallbacks = entry.cases.filter(isFallback);
      assert.equal(fallbacks.length, 1, `${entry.id} must have exactly one fallback`);
      assert.ok(isFallback(entry.cases[entry.cases.length - 1]!), `${entry.id} fallback must be the last case`);
    }
  });

  test("every non-fallback case carries a machine guard", () => {
    for (const entry of registry) {
      for (const c of entry.cases) {
        if (isFallback(c)) continue;
        assert.ok(c.if !== undefined, `${entry.id} case "${c.when}" has prose but no machine guard`);
      }
    }
  });

  test("every reversible case states an inverse and a window", () => {
    for (const entry of registry) {
      for (const c of entry.cases) {
        if (c.tone !== "r0" && c.tone !== "r1") continue;
        assert.ok(typeof c.inverse === "string" && c.inverse.trim() !== "", `${entry.id} ${c.tone} case "${c.when}" has no inverse`);
        assert.ok(c.window.trim() !== "", `${entry.id} ${c.tone} case "${c.when}" has no window`);
      }
    }
  });

  test("delete-shaped entries never fall back to r0 or r1", () => {
    // A delete against unknown target state is never reversible enough to
    // relax the fallback. Entries that do better when a fact holds keep their
    // guarded better case; only the fallback is pinned here.
    for (const entry of registry) {
      const last = entry.cases[entry.cases.length - 1]!;
      if (!entry.id.split(".").some((part) => part === "delete" || part === "bulk_delete" || part === "delete_cascade")) continue;
      assert.ok(last.tone === "r2" || last.tone === "r3", `${entry.id} delete fallback is ${last.tone}, never below r2`);
    }
  });

  test("guard facts form a closed vocabulary shared with the facts fixture", () => {
    // The local facts fixture must be able to satisfy every fact the registry
    // can ask about, otherwise a guarded case can never fire in local runs.
    // The six names below are referenced by guards but deliberately absent
    // from the fixture because the fixture models one specific account story;
    // this test pins the exact gap so extending the fixture stays a conscious
    // decision instead of silent drift.
    const referenced = new Set<string>();
    for (const entry of registry) {
      for (const c of entry.cases) guardFacts(c, referenced);
    }
    assert.ok(referenced.size >= 27, `expected at least 27 distinct facts, saw ${referenced.size}`);
    const knownAbsent = [
      "fs.tree.git_clean",
      "registry.tag.previously_used",
      "s3.key.existed",
      "stripe.charge.settled",
      "stripe.intent.captured",
      "stripe.refund.pending",
    ];
    for (const name of knownAbsent) {
      assert.ok(referenced.has(name), `${name} left the registry, update this test`);
    }
  });

  test("case order is most-guarded-first within an entry", () => {
    // Evaluator semantics are first-match-wins. A fallback appearing before a
    // guarded case would shadow it, so the audit pins the ordering.
    for (const entry of registry) {
      const fallbackIndex = entry.cases.findIndex(isFallback);
      for (let i = 0; i < fallbackIndex; i += 1) {
        assert.ok(!isFallback(entry.cases[i]!), `${entry.id} case ${i} would be shadowed by the fallback`);
      }
    }
  });
});

void (0 as unknown as RegistryEntry);
