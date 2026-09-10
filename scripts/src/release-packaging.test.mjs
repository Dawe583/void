import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const manifest = (path) => JSON.parse(read(path));
const packageDirs = readdirSync(new URL("packages/", root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`packages/${entry.name}/package.json`, root)))
  .map((entry) => `packages/${entry.name}`);
const directories = [".", ...packageDirs, "apps/control-plane", "scripts"];

for (const directory of directories) {
  test(`${directory} stays private with coherent development release metadata`, () => {
    const data = manifest(`${directory}/package.json`);
    assert.match(data.name, /^@void\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
    if (directory.startsWith("packages/")) {
      assert.equal(data.name, `@void/${directory.slice("packages/".length)}`);
    }
    assert.equal(data.version, "0.1.0");
    assert.equal(data.private, true);
    assert.equal(data.engines.node, ">=24");
    assert.equal(typeof data.description, "string");
    assert.ok(data.description.length > 20);
    assert.ok(Array.isArray(data.keywords) && data.keywords.length >= 2);
    if (directory !== ".") {
      assert.deepEqual(data.repository, {
        type: "git",
        url: "git+https://github.com/Dawe583/void.git",
        directory,
      });
      assert.equal(data.homepage, `https://github.com/Dawe583/void/tree/main/${directory}`);
    }
  });
}

const bins = {
  void: "packages/cli/bin/void.mjs",
  "void-proxy": "packages/proxy/bin/void-proxy.mjs",
};

test("root bin mappings resolve to the development entrypoints", () => {
  assert.deepEqual(manifest("package.json").bin, bins);
});

for (const [name, path] of Object.entries(bins)) {
  test(`${name} has an executable Node shebang and valid syntax`, () => {
    assert.equal(read(path).split("\n")[0], "#!/usr/bin/env node");
    const checked = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(path, root))], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(checked.error);
    assert.equal(checked.status, 0, checked.stderr);
  });
}

test("license metadata follows the existing license or reports its absence", () => {
  const release = read("docs/RELEASE.md");
  if (!existsSync(new URL("LICENSE", root))) {
    assert.match(release, /(?:missing|absent|no) (?:root )?LICENSE/i);
    return;
  }
  assert.match(read("LICENSE"), /Apache License\s+Version 2\.0/);
  for (const directory of directories) {
    assert.equal(manifest(`${directory}/package.json`).license, "Apache-2.0");
  }
});

test("release notes keep the source distribution and runtime limits visible", () => {
  const release = read("docs/RELEASE.md");
  assert.match(release, /private: true/);
  assert.match(release, /node_modules/);
  assert.match(release, /22\.18/);
  assert.match(release, /Credential-blocked git push/);
  assert.match(release, /Real-service e2e/);
  assert.match(release, /Publish CI/);
  for (const path of ["docs/RELEASE.md", "packages/proxy/docs/interface.md"]) {
    assert.doesNotMatch(read(path), /[\u2013\u2014]/);
  }
});
