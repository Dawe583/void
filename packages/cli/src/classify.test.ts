import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseTranscript,
  classifyCall,
  classifyTranscript,
  formatClassifyReport,
  runClassifyCommand,
  REGISTRY_SIZE,
  type TranscriptCall,
} from "./classify.ts";

const s3Delete = "aws.s3.object.delete";
const pgUpdate = "postgres.row.update";

describe("parseTranscript", () => {
  test("reads one JSON object per line and skips blanks", () => {
    const text = `{"tool": "t", "arguments": {"id": 1}}\n\n{"tool": "t2"}\n`;
    const calls = parseTranscript(text);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].arguments?.id, 1);
  });

  test("a malformed line is a named load error, not a dropped call", () => {
    assert.throws(() => parseTranscript(`{"tool": "t"}\nnot json\n`), /line 2/);
    assert.throws(() => parseTranscript(`{"arguments": {}}\n`), /line 1.*tool/);
    assert.throws(() => parseTranscript(`[1,2]\n`), /line 1/);
  });
});

describe("classifyCall", () => {
  test("an unknown tool id is unknown-tool, never a guessed class", () => {
    assert.equal(classifyCall({ tool: "no.such.tool" }).outcome, "unknown-tool");
  });

  test("a migrated entry classifies from declared facts alone", () => {
    // The pilot migration landed structured ifs on this entry, so the
    // declared facts decide it with no arguments in play.
    const result = classifyCall({
      tool: s3Delete,
      facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" },
    });
    assert.equal(result.outcome, "classified");
    if (result.outcome === "classified") assert.equal(result.tone, "r0");
  });

  test("facts absent fall to the structured worst case, never a guess", () => {
    // The entry is fully migrated, so absent facts decide the terminal
    // always case: r3, the class policy must assume anyway.
    const result = classifyCall({ tool: s3Delete, facts: {} });
    assert.equal(result.outcome, "classified");
    if (result.outcome === "classified") assert.equal(result.tone, "r3");
  });

  test("a tool outside the registry is unknown, never guessed", () => {
    // The audit pass migrated the last real unmigrated registry entry, so the
    // CLI-level specimen for unmigrated prose no longer exists. The honest
    // remaining CLI assertion is that an absent tool is a distinct outcome
    // from an undecided one, with no assumed class either way.
    const result = classifyCall({ tool: "specimen.never.migrated", facts: {} });
    assert.equal(result.outcome, "unknown-tool");
    if (result.outcome === "unknown-tool") assert.equal(result.assume, undefined);
  });
});

describe("classifyTranscript, the distribution", () => {
  test("counts are honest over a mixed session", () => {
    const calls: TranscriptCall[] = [
      { tool: s3Delete, facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" } },
      { tool: s3Delete },
      { tool: pgUpdate },
      { tool: "vendor.something.absent" },
    ];
    const report = classifyTranscript(calls);
    assert.equal(report.total, 4);
    assert.equal(report.distribution.r0, 1);
    // Both migrated entries decide without facts through the always
    // fallback, and both fallbacks are the worst class: the fail closed
    // posture shows up as r3, not as undecided calls.
    assert.equal(report.distribution.r3, 2);
    assert.equal(report.distribution.unclassified, 0);
    assert.equal(report.distribution["unknown-tool"], 1);
    assert.equal(report.unclassifiedShare, 0);
  });

  test("an empty transcript is zero, not a crash", () => {
    const report = classifyTranscript([]);
    assert.equal(report.total, 0);
    assert.equal(report.unclassifiedShare, 0);
  });

  test("the printed report shows every bucket and the share", () => {
    const report = classifyTranscript([{ tool: s3Delete }]);
    const text = formatClassifyReport(report);
    assert.ok(text.includes("calls: 1"));
    assert.ok(text.includes("unclassified: 0%"));
    assert.ok(text.includes("unknown-tool: 0"));
    assert.ok(text.includes("r3: 1"));
  });
});

describe("the registry precondition", () => {
  test("the registry loads and is the published size", () => {
    // Registry expansion changes this count deliberately, so this stays a
    // tripwire for clients that publish the same registry surface.
    assert.equal(REGISTRY_SIZE, 270);
  });
});


describe("runClassifyCommand, the command surface", () => {
  test("declared facts apply to the whole transcript", async () => {
    const files: Record<string, string> = {
      "s.jsonl": JSON.stringify({ tool: s3Delete }) + "\n",
      "f.json": JSON.stringify({ "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" }),
    };
    const out: string[] = [];
    const code = await runClassifyCommand(
      ["--transcript", "s.jsonl", "--facts", "f.json"],
      (path) => files[path] ?? (() => { throw new Error("no file " + path); })(),
      (line) => out.push(line),
    );
    assert.equal(code, 0);
    assert.ok(out.join("\n").includes("r0: 1"));
  });

  test("a malformed transcript is a named load error", async () => {
    await assert.rejects(
      runClassifyCommand(["--transcript", "bad.jsonl"], () => "nope\n", () => {}),
      /line 1/,
    );
  });

  test("per-call facts override the declared file", async () => {
    const files: Record<string, string> = {
      "s.jsonl": JSON.stringify({ tool: s3Delete, facts: { "bucket.versioning": "Disabled" } }) + "\n",
      "f.json": JSON.stringify({ "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" }),
    };
    const out: string[] = [];
    await runClassifyCommand(
      ["--transcript", "s.jsonl", "--facts", "f.json"],
      (path) => files[path],
      (line) => out.push(line),
    );
    // The per-call Disabled wins over the declared Enabled, the r0 guard
    // fails on a present-but-wrong fact, and the structured always fallback
    // answers r3: the override is visible in the distribution, not ignored.
    assert.ok(out.join("\n").includes("r3: 1"));
    assert.ok(out.join("\n").includes("unclassified: 0%"));
  });
});
