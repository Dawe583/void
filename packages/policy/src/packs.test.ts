import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide } from "./decide.ts";
import type { PolicyCall } from "./decide.ts";
import { loadPack, listPacks, PackError } from "./packs.ts";

const calls: readonly PolicyCall[] = ["r0", "r1", "r2", "r3"].map((klass) => ({
  tool: "postgres.row.delete",
  connector: "postgres",
  workspace: "pack-test",
  klass,
  blastRadius: 41883,
}));

const expectations = [
  { name: "dev", kinds: ["allow", "allow", "allow", "hold"], seconds: 60, notify: ["cli"] },
  { name: "balanced", kinds: ["allow", "allow", "hold", "deny"], seconds: 300, notify: ["cli", "slack"] },
  { name: "strict", kinds: ["allow", "deny", "deny", "deny"], seconds: undefined, notify: [] },
] as const;

for (const expected of expectations) {
  test(`${expected.name} loads a complete version 1 policy`, async () => {
    const loaded = await loadPack(expected.name);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.policy.version, 1);
    assert.deepEqual(loaded.policy.rules.at(-1)?.match, {});
    assert.equal(loaded.policy.rules.at(-1)?.decision, "deny");
  });

  for (const [index, call] of calls.entries()) {
    test(`${expected.name} decides ${call.klass} as ${expected.kinds[index]}`, async () => {
      const result = decide(await loadPack(expected.name), call);
      assert.equal(result.kind, expected.kinds[index]);
      if (result.kind === "hold") {
        assert.equal(result.seconds, expected.seconds);
        assert.deepEqual(result.notify, expected.notify);
      }
    });
  }

  test(`${expected.name} denies classes outside its known rules`, async () => {
    const loaded = await loadPack(expected.name);
    assert.equal(decide(loaded, { ...calls[0]!, klass: "unclassified" }).kind, "deny");
  });
}

test("listPacks includes exactly the three built-in packs", () => {
  assert.deepEqual([...listPacks()].sort(), ["balanced", "dev", "strict"]);
});

test("loadPack uses the override directory instead of the package directory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-packs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "dev.yaml"), "version: 1\nrules:\n  - match: {}\n    decision: deny\n");
  assert.equal(decide(await loadPack("dev", dir), calls[0]!).kind, "deny");
});

for (const [label, text] of [
  ["malformed YAML", "version: ["],
  ["unknown keys", "version: 1\nrules:\n  - match: {}\n    decision: allow\n    typo: true\n"],
  ["invalid version", "version: 2\nrules:\n  - match: {}\n    decision: allow\n"],
  ["malformed rules", "version: 1\nrules: [null]\n"],
] as const) {
  test(`loadPack throws PackError for ${label} in an override`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "void-packs-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "dev.yaml"), text);
    await assert.rejects(loadPack("dev", dir), PackError);
  });
}

test("loadPack does not fall back when an override file is missing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-packs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(loadPack("dev", dir), PackError);
});

for (const name of ["unknown", "../dev", "dev.yaml"]) {
  test(`loadPack refuses unknown pack name ${name}`, async () => {
    await assert.rejects(loadPack(name), PackError);
  });
}
