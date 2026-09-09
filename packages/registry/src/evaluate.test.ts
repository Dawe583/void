import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  registry,
  findEntry,
  evaluate,
  classifyTool,
  holds,
  validatePrecondition,
  PRECONDITION_KINDS,
  type RegistryEntry,
  type Precondition,
} from "./index.ts";

// A migrated entry is the honest fixture: one with structured ifs beside the
// prose, so the tests exercise the shape the registry is moving to rather than
// a hand built parallel universe. Until the migration lands for real, the
// structured form is attached in the test by hand, which is also how
// un-migrated entries behave for a caller: the evaluator reads `if` when
// present and falls back to the prose-reading contract otherwise.
const s3Delete = findEntry("aws.s3.object.delete") as RegistryEntry;
const withIfs = (entry: RegistryEntry, ifs: Record<number, Precondition>): RegistryEntry => ({
  ...entry,
  cases: entry.cases.map((item, index) =>
    ifs[index] === undefined ? item : { ...item, if: ifs[index] },
  ),
});

const versioningOn = {
  facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" },
  args: {},
};
const versioningOff = {
  facts: { "bucket.versioning": "Disabled", "bucket.mfa_delete": "off" },
  args: {},
};
const withVersionId = {
  facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" },
  args: { versionId: "v123" },
};

const s3DeleteStructured = withIfs(s3Delete, {
  // Case 0 must also require versionId absent: a delete with an explicit
  // versionId is permanent destruction, so letting the r0 marker case win
  // on order would classify the worst call as the best class. The guard
  // keeps the prose and the order intact while making the table truthful.
  0: { kind: "all", of: [
    { kind: "fact", fact: "bucket.versioning", is: "Enabled" },
    { kind: "fact", fact: "bucket.mfa_delete", is: "off" },
    { kind: "argument", argument: "versionId", operator: "absent" },
  ] },
  1: { kind: "argument", argument: "versionId", operator: "present" },
});

describe("evaluate, the classified path", () => {
  test("versioning enabled and mfa off selects the r0 case", () => {
    const result = evaluate(s3DeleteStructured, versioningOn);
    assert.equal(result.outcome, "classified");
    if (result.outcome !== "classified") return;
    assert.equal(result.caseIndex, 0);
    assert.equal(result.tone, "r0");
  });

  test("an explicit versionId selects the r3 case even with versioning on", () => {
    // The first case wins on order, which is why this argument precondition
    // must sit above the fact precondition in the case list.
    const result = evaluate(s3DeleteStructured, withVersionId);
    assert.equal(result.outcome, "classified");
    if (result.outcome !== "classified") return;
    assert.equal(result.caseIndex, 1);
    assert.equal(result.tone, "r3");
  });

  test("an entry without structured cases is unclassified with no assumption", () => {
    // The audit pass migrated the last real unmigrated entry (mysql.table.truncate), so the
    // unmigrated path is exercised by a local specimen rather than by finding drift in the
    // live registry.
    const unmigrated: RegistryEntry = {
      id: "specimen.unmigrated.delete",
      vendor: "specimen",
      surface: "Specimens",
      summary: "Test fixture for the unmigrated path.",
      tags: ["test"],
      cases: [{ when: "always", tone: "r3", inverse: null, window: "none", note: "specimen" }],
    };
    const result = evaluate(unmigrated, versioningOn);
    assert.equal(result.outcome, "unclassified");
    if (result.outcome !== "unclassified") return;
    assert.equal(result.assumeTone, null);
  });

  test("the matched case carries its prose for the hold message", () => {
    const result = evaluate(s3DeleteStructured, versioningOn);
    if (result.outcome !== "classified") return;
    assert.ok(result.reason.includes("versioning"));
  });
});

describe("evaluate, the unclassified path", () => {
  // A fully migrated entry ends in a structured always case, so it always
  // classifies. The tri-state below is the transitional state the full
  // migration still has entries in: guards migrated, fallback not yet, and
  // this synthetic entry documents exactly what the hold message gets.
  const halfMigrated: RegistryEntry = {
    ...s3Delete,
    cases: s3Delete.cases.slice(0, 2).map((item, index) =>
      index === 0
        ? { ...item, if: { kind: "all", of: [
            { kind: "fact", fact: "bucket.versioning", is: "Enabled" },
            { kind: "fact", fact: "bucket.mfa_delete", is: "off" },
          ] } }
        : item,
    ),
  };

  test("missing facts are named, not guessed around", () => {
    const result = evaluate(halfMigrated, { facts: {}, args: {} });
    assert.equal(result.outcome, "unclassified");
    if (result.outcome !== "unclassified") return;
    assert.ok(result.missingFacts.includes("bucket.versioning"));
    assert.ok(result.missingFacts.includes("bucket.mfa_delete"));
    // The tone to assume is the worst among cases that failed only because
    // their facts were absent: the r0 case, not a guess.
    assert.equal(result.assumeTone, "r0");
  });

  test("a fact that is present but wrong is a real non match, not a missing fact", () => {
    const result = evaluate(halfMigrated, versioningOff);
    assert.equal(result.outcome, "unclassified");
    if (result.outcome !== "unclassified") return;
    assert.equal(result.assumeTone, null);
    assert.deepEqual(result.missingFacts, []);
  });

  test("a fully migrated entry never answers unclassified, the fallback decides", () => {
    // Facts unknown means the r0 guard fails on absent facts, the versionId
    // guard fails on a missing argument, and the structured always case
    // answers the worst class rather than leaving the call undecided.
    const result = evaluate(s3Delete, { facts: {}, args: {} });
    assert.equal(result.outcome, "classified");
    if (result.outcome !== "classified") return;
    assert.equal(result.tone, "r3");
    assert.equal(result.caseIndex, 2);
  });

  test("an unknown tool reports unknown-tool, not unclassified", () => {
    // evaluate answers for an entry it was handed, so the unknown tool
    // outcome belongs to the pipeline wrapper that looks entries up.
    const result = classifyTool("no.such.tool", { facts: {}, args: {} });
    assert.equal(result.outcome, "unknown-tool");
    if (result.outcome !== "unknown-tool") return;
    assert.equal(result.entryId, "no.such.tool");
  });
});

describe("holds, the precondition evaluator", () => {
  test("a fact without is matches any present non-empty value", () => {
    assert.equal(holds({ kind: "fact", fact: "pg.version" }, { "pg.version": "16.13" }, {}), true);
    assert.equal(holds({ kind: "fact", fact: "pg.version" }, { "pg.version": "" }, {}), false);
    assert.equal(holds({ kind: "fact", fact: "pg.version" }, {} , {}), false);
  });

  test("a boolean fact is checked with is for exactness", () => {
    assert.equal(holds({ kind: "fact", fact: "flag", is: "true" }, { flag: true }, {}), false);
    assert.equal(holds({ kind: "fact", fact: "flag" }, { flag: true }, {}), true);
  });

  test("argument preconditions cover present, absent and equals", () => {
    const facts = {};
    assert.equal(holds({ kind: "argument", argument: "id", operator: "present" }, facts, { id: 7 }), true);
    assert.equal(holds({ kind: "argument", argument: "id", operator: "present" }, facts, { id: null }), false);
    assert.equal(holds({ kind: "argument", argument: "id", operator: "absent" }, facts, {}), true);
    assert.equal(holds({ kind: "argument", argument: "mode", operator: "equals", value: "dry" }, facts, { mode: "dry" }), true);
    assert.equal(holds({ kind: "argument", argument: "mode", operator: "equals", value: "dry" }, facts, { mode: "wet" }), false);
  });

  test("the terminal kind matches everything and rejects company", () => {
    assert.equal(holds({ kind: "always" }, {}, {}), true);
    assert.equal(holds({ kind: "not", of: { kind: "always" } }, {}, {}), false);
    assert.deepEqual(validatePrecondition({ kind: "always", of: { kind: "fact", fact: "f" } }, "p"),
      ["p: unknown key of"]);
  });

  test("not, all and any compose", () => {
    const facts = { a: "1", b: "2" };
    assert.equal(holds({ kind: "not", of: { kind: "fact", fact: "a" } }, facts, {}), false);
    assert.equal(holds({ kind: "not", of: { kind: "fact", fact: "c" } }, facts, {}), true);
    assert.equal(holds({ kind: "all", of: [
      { kind: "fact", fact: "a" },
      { kind: "fact", fact: "b" },
    ] }, facts, {}), true);
    assert.equal(holds({ kind: "all", of: [
      { kind: "fact", fact: "a" },
      { kind: "fact", fact: "c" },
    ] }, facts, {}), false);
    assert.equal(holds({ kind: "any", of: [
      { kind: "fact", fact: "c" },
      { kind: "fact", fact: "a" },
    ] }, facts, {}), true);
    assert.equal(holds({ kind: "any", of: [
      { kind: "fact", fact: "c" },
      { kind: "fact", fact: "d" },
    ] }, facts, {}), false);
  });

  test("preconditions nesting past the bound throw rather than overflow the stack", () => {
    let deep: Precondition = { kind: "fact", fact: "x" };
    for (let i = 0; i < 40; i += 1) deep = { kind: "not", of: deep };
    assert.throws(() => holds(deep, { x: "1" }, {}), TypeError);
  });
});

describe("validatePrecondition, the closed grammar", () => {
  test("every kind is accepted with its required keys", () => {
    const valid: Precondition[] = [
      { kind: "fact", fact: "f" },
      { kind: "fact", fact: "f", is: "v" },
      { kind: "not", of: { kind: "fact", fact: "f" } },
      { kind: "argument", argument: "a", operator: "present" },
      { kind: "argument", argument: "a", operator: "equals", value: "v" },
      { kind: "all", of: [{ kind: "fact", fact: "f" }] },
      { kind: "any", of: [{ kind: "fact", fact: "f" }] },
      { kind: "always" },
    ];
    for (const item of valid) {
      assert.deepEqual(validatePrecondition(item, "p"), [], JSON.stringify(item));
    }
    // The terminal kind is part of the grammar since the pilot migration
    // made fallback cases explicit; the count pins the closed set.
    assert.equal(PRECONDITION_KINDS.length, 6);
  });

  test("unknown kinds, keys and shapes are load errors with the path in them", () => {
    assert.ok(validatePrecondition({ kind: "maybe" }, "p")[0].includes("p.kind"));
    assert.ok(validatePrecondition({ kind: "fact", fact: "f", extra: 1 }, "p")[0].includes("unknown key"));
    assert.ok(validatePrecondition({ kind: "fact" }, "p")[0].includes("fact name"));
    assert.ok(validatePrecondition({ kind: "all", of: [] }, "p")[0].includes("at least one"));
    assert.ok(
      validatePrecondition({ kind: "argument", argument: "a", operator: "equals" }, "p")[0].includes("value"),
    );
    assert.ok(validatePrecondition(null, "p")[0].includes("object"));
  });
});
