import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadPolicy, validatePolicyFile } from "./rules.ts";
import { decide, type PolicyCall } from "./decide.ts";

const goodYaml = readFileSync(new URL("../../../policy/default.yaml", import.meta.url), "utf8");

const call = (over: Partial<PolicyCall> = {}): PolicyCall => ({
  tool: "aws.s3.object.delete",
  connector: "s3",
  workspace: "prod",
  klass: "r0",
  blastRadius: 1,
  ...over,
});

describe("loadPolicy, the closed grammar", () => {
  test("the shipped default policy loads", () => {
    const loaded = loadPolicy(goodYaml);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.policy.rules.length, 5);
  });

  test("a wrong version or missing rules is a named error", () => {
    const bad = loadPolicy("version: 2\nrules: []");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.errors.some((e) => e.includes("version")));
  });

  test("an unknown match key is a load error, never a silent no-op", () => {
    const bad = loadPolicy(`
version: 1
rules:
  - match: { blast_radus: 5 }
    decision: allow
  - match: {}
    decision: hold
    seconds: 60
`);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.errors.some((e) => e.includes("blast_radus")));
  });

  test("a hold without a timer, or a timer off hold, is a load error", () => {
    const noTimer = loadPolicy(`
version: 1
rules:
  - match: { class: r2 }
    decision: hold
  - match: {}
    decision: hold
    seconds: 60
`);
    assert.equal(noTimer.ok, false);
    const timerOffHold = loadPolicy(`
version: 1
rules:
  - match: { class: r2 }
    decision: allow
    seconds: 60
  - match: {}
    decision: hold
    seconds: 60
`);
    assert.equal(timerOffHold.ok, false);
  });

  test("the catch-all must exist and must be last", () => {
    const notLast = loadPolicy(`
version: 1
rules:
  - match: {}
    decision: allow
  - match: { class: r2 }
    decision: hold
    seconds: 60
`);
    assert.equal(notLast.ok, false);
    if (!notLast.ok) assert.ok(notLast.errors.some((e) => e.includes("catch-all")));
  });

  test("the hold ceiling is 900 seconds, the MCP request cannot outlive every client", () => {
    const tooLong = loadPolicy(`
version: 1
rules:
  - match: { class: r2 }
    decision: hold
    seconds: 9000
  - match: {}
    decision: hold
    seconds: 60
`);
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.ok(tooLong.errors.some((e) => e.includes("900")));
  });

  test("blast_radius is the only comparison, and only lt", () => {
    const wrongOp = validatePolicyFile({
      version: 1,
      rules: [{ match: { blast_radius: { gt: 5 } }, decision: "allow" }, { match: {}, decision: "hold", seconds: 60 }],
    });
    assert.ok(wrongOp.some((e) => e.includes("blast_radius")));
  });
});

describe("decide, first match wins", () => {
  const policy = loadPolicy(goodYaml);
  if (!policy.ok) throw new Error("fixture policy must load");

  test("r0 goes through", () => {
    assert.equal(decide(policy, call()).kind, "allow");
  });

  test("r1 under the line goes through, over the line holds", () => {
    assert.equal(decide(policy, call({ klass: "r1", blastRadius: 99 })).kind, "allow");
    assert.equal(decide(policy, call({ klass: "r1", blastRadius: 100 })).kind, "hold");
  });

  test("a list value means any of, so r2 and r3 both hold", () => {
    assert.equal(decide(policy, call({ klass: "r2" })).kind, "hold");
    const held = decide(policy, call({ klass: "r3" }));
    assert.equal(held.kind, "hold");
    if (held.kind === "hold") {
      assert.equal(held.seconds, 120);
      assert.deepEqual([...held.notify].sort(), ["cli", "slack"]);
    }
  });

  test("a named tool denies before the class rules can hold it", () => {
    const denied = decide(policy, call({ tool: "postgres.table.drop", klass: "r2" }));
    assert.equal(denied.kind, "deny");
  });

  test("an unspecified workspace never matches a workspace rule", () => {
    const fenced = loadPolicy(`
version: 1
rules:
  - match: { workspace: prod }
    decision: allow
  - match: {}
    decision: hold
    seconds: 60
`);
    if (!fenced.ok) throw new Error("fixture must load");
    assert.equal(decide(fenced, call({ workspace: undefined })).kind, "hold");
    assert.equal(decide(fenced, call({ workspace: "staging" })).kind, "hold");
    assert.equal(decide(fenced, call({ workspace: "prod" })).kind, "allow");
  });
});
