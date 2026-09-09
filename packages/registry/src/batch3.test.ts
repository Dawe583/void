import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyTool, findEntry, registry, validatePrecondition } from "./index.ts";
import type { Precondition, RegistryEntry } from "./index.ts";

const fixtureDirectory = new URL("../../../fixtures/registry/", import.meta.url);
const batch: { entries: RegistryEntry[]; factsAdded: string[]; sources: Record<string, string> } = JSON.parse(
  readFileSync(new URL("wp04b-batch3.json", fixtureDirectory), "utf8"),
);

test("batch 3 publishes at least 100 distinct new entries exactly as reviewed", () => {
  assert.ok(batch.entries.length >= 100);
  assert.equal(new Set(batch.entries.map((entry) => entry.id)).size, batch.entries.length);
  for (const expected of batch.entries) {
    assert.deepEqual(findEntry(expected.id), expected, expected.id);
    assert.ok(batch.sources[expected.id]?.startsWith("https://"), expected.id);
  }
  assert.equal(registry.length, 163 + batch.entries.length);
});

function conjuncts(guard: Precondition): Extract<Precondition, { kind: "fact" }>[] {
  if (guard.kind === "fact") return [guard];
  assert.equal(guard.kind, "all", "batch 3 guards must require every positive fact");
  if (guard.kind !== "all") throw new Error("unsupported guard");
  return guard.of.flatMap(conjuncts);
}

test("every guarded case needs every declared conjunct, with exact string values", () => {
  let checked = 0;
  for (const entry of batch.entries) {
    for (const [caseIndex, item] of entry.cases.entries()) {
      assert.deepEqual(validatePrecondition(item.if, entry.id), [], entry.id);
      assert.ok(item.if);
      if (item.if.kind === "always") continue;
      const atoms = conjuncts(item.if);
      const facts: Record<string, string | boolean> = {};
      for (const atom of atoms) {
        assert.equal(typeof atom.is, "string", `${entry.id}: exact values are required`);
        facts[atom.fact] = atom.is!;
      }
      const matched = classifyTool(entry.id, { facts, args: {} });
      assert.equal(matched.outcome, "classified", entry.id);
      if (matched.outcome !== "classified") throw new Error(entry.id);
      assert.equal(matched.caseIndex, caseIndex, entry.id);
      assert.equal(matched.tone, item.tone, entry.id);
      for (const atom of atoms) {
        for (const invalid of [undefined, "wrong", true, false, ""] as const) {
          const mutated = { ...facts, [atom.fact]: invalid };
          const result = classifyTool(entry.id, { facts: mutated, args: {} });
          assert.equal(result.outcome, "classified", `${entry.id}: ${atom.fact}`);
          if (result.outcome !== "classified") throw new Error(entry.id);
          assert.notEqual(result.caseIndex, caseIndex, `${entry.id}: ${atom.fact}=${String(invalid)}`);
          assert.equal(result.caseIndex, entry.cases.length - 1, entry.id);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 100, "the mutation test must exercise real guards");
});

test("unknown target facts select the terminal conservative case", () => {
  for (const entry of batch.entries) {
    const fallback = entry.cases.at(-1)!;
    assert.equal(fallback.when, "always", entry.id);
    assert.deepEqual(fallback.if, { kind: "always" }, entry.id);
    const result = classifyTool(entry.id, { facts: {}, args: {} });
    assert.equal(result.outcome, "classified", entry.id);
    if (result.outcome !== "classified") throw new Error(entry.id);
    assert.equal(result.caseIndex, entry.cases.length - 1, entry.id);
    assert.equal(result.tone, fallback.tone, entry.id);
    assert.ok(result.tone === "r2" || result.tone === "r3", entry.id);
    for (const item of entry.cases) {
      if (item.tone === "r2" || item.tone === "r3") assert.equal(item.inverse, null, entry.id);
      else assert.ok(item.inverse, entry.id);
    }
  }
});

test("all new facts are documented and are used by a reviewed guard", () => {
  const docs = readFileSync(new URL("../docs/facts.md", import.meta.url), "utf8");
  const used = new Set(batch.entries.flatMap((entry) => entry.cases.flatMap((item) =>
    item.if && item.if.kind !== "always" ? conjuncts(item.if).map((atom) => atom.fact) : [],
  )));
  assert.ok(batch.factsAdded.length > 0);
  for (const name of batch.factsAdded) {
    assert.ok(used.has(name), name);
    assert.ok(docs.includes(`| ${name} | string |`), name);
  }
});

