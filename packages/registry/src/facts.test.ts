import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateFactsFile,
  loadFacts,
  toEvaluationContext,
  type FactsFile,
  type FactsReport,
} from "./facts.ts";
import { evaluate, type RegistryEntry } from "./index.ts";

const HOUR = 3_600_000;
const now = new Date("2026-09-08T12:00:00Z");
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR).toISOString();

const file: FactsFile = {
  facts: {
    "bucket.versioning": { value: "Enabled", verifiedAt: at(100), source: "manual" },
    "bucket.mfa_delete": { value: "off", verifiedAt: at(200), source: "manual" },
    "pg.instance.backup": { value: true, verifiedAt: at(1), source: "probe:local" },
  },
};

describe("validateFactsFile, the closed grammar", () => {
  test("a valid file passes with no errors", () => {
    assert.deepEqual(validateFactsFile(file), []);
  });

  test("wrong shapes are load errors with the path in them", () => {
    assert.ok(validateFactsFile(null)[0].includes("object"));
    assert.ok(validateFactsFile({ extra: 1 })[0].includes("unknown key"));
    assert.ok(validateFactsFile({ facts: 7 })[0].includes("facts"));
    const badFact = { facts: { oops: { value: 1, verifiedAt: at(1), source: "manual" } } };
    assert.ok(validateFactsFile(badFact).some((e) => e.includes("facts.oops.value")));
    const nonIso = { facts: { f: { value: "v", verifiedAt: "yesterday", source: "manual" } } };
    assert.ok(validateFactsFile(nonIso).some((e) => e.includes("ISO 8601")));
    const noSource = { facts: { f: { value: "v", verifiedAt: at(1), source: "" } } };
    assert.ok(validateFactsFile(noSource).some((e) => e.includes("source")));
    const unknownKey = { facts: { f: { value: "v", verifiedAt: at(1), source: "s", ttl: 5 } } };
    assert.ok(validateFactsFile(unknownKey).some((e) => e.includes("unknown key")));
  });
});

describe("loadFacts, staleness as a warning", () => {
  test("fresh facts load with values the evaluator accepts", () => {
    // 240h window: the 200h old mfa fact is still inside it, so nothing is
    // stale and the staleness half of the report stays empty.
    const report = loadFacts(file, now, 240);
    assert.equal(report.values["bucket.versioning"], "Enabled");
    assert.equal(report.values["pg.instance.backup"], true);
    assert.equal(report.stale.length, 0);
  });

  test("age rounds down and the window boundary is not yet stale", () => {
    const report = loadFacts(file, now);
    const mfa = report.statuses.find((s) => s.name === "bucket.mfa_delete");
    assert.ok(mfa);
    assert.equal(mfa.ageHours, 200);
    assert.equal(mfa.stale, true);

    const boundary: FactsFile = {
      facts: { f: { value: "v", verifiedAt: at(168), source: "manual" } },
    };
    const atWindow = loadFacts(boundary, now, 168);
    assert.equal(atWindow.statuses[0].ageHours, 168);
    assert.equal(atWindow.statuses[0].stale, false);
  });

  test("a stale fact still evaluates, the report carries the warning", () => {
    const staleFile: FactsFile = {
      facts: { "bucket.versioning": { value: "Disabled", verifiedAt: at(500), source: "manual" } },
    };
    const report = loadFacts(staleFile, now);
    assert.equal(report.stale.length, 1);
    assert.equal(report.values["bucket.versioning"], "Disabled");
  });
});

describe("toEvaluationContext, wiring to the evaluator", () => {
  test("the report becomes a context evaluate can consume", () => {
    const report = loadFacts(file, now);
    const context = toEvaluationContext(report, { key: "a/b" });
    assert.equal(context.facts["bucket.versioning"], "Enabled");
    assert.equal(context.args.key, "a/b");

    // A migrated-style entry proves the wiring end to end: the structured
    // form matches and the call classifies, all from declared facts.
    const entry = {
      id: "aws.s3.object.delete",
      vendor: "aws",
      surface: "S3",
      summary: "Delete an object by key.",
      tags: ["storage", "delete"],
      cases: [
        {
          when: "bucket versioning is Enabled",
          tone: "r0",
          inverse: "s3:DeleteObject on the delete marker",
          window: "until expiry",
          note: "marker",
          if: { kind: "fact", fact: "bucket.versioning", is: "Enabled" },
        },
        { when: "always", tone: "r3", inverse: null, window: "none", note: "gone" },
      ],
    } as unknown as RegistryEntry;
    const result = evaluate(entry, context);
    assert.equal(result.outcome, "classified");
    if (result.outcome === "classified") assert.equal(result.tone, "r0");
  });
});
