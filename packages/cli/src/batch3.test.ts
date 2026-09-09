import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import type { RegistryEntry } from "@void/registry";
import { classifyTranscript, parseTranscript } from "./classify.ts";

const fixtureDirectory = new URL("../../../fixtures/registry/", import.meta.url);

test("CLI classifies every old and new registry fixture and the reference transcript", () => {
  const paths = readdirSync(fixtureDirectory).filter((path) => path.endsWith(".json"));
  assert.ok(paths.includes("wp04b-batch2.json"));
  assert.ok(paths.includes("wp04b-batch3.json"));
  const calls = paths.flatMap((path) => {
    const fixture: { entries: RegistryEntry[] } = JSON.parse(
      readFileSync(new URL(path, fixtureDirectory), "utf8"),
    );
    assert.ok(fixture.entries.length > 0, path);
    return fixture.entries.map((entry) => ({ tool: entry.id }));
  });
  calls.push(...parseTranscript(readFileSync(new URL("../../../fixtures/session.jsonl", import.meta.url), "utf8")));
  const report = classifyTranscript(calls);
  assert.equal(report.total, calls.length);
  assert.ok(report.total > 200);
  assert.equal(report.distribution["unknown-tool"], 0);
  assert.equal(report.distribution.unclassified, 0);
  assert.equal(report.unclassifiedShare, 0);
});
