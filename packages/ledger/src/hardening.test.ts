import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertPrivateKeyFileMode, sanitizeWorkspace } from "./hardening.ts";
import { devKeyProvider } from "./sign.ts";
import { jsonlStore } from "./store.ts";

describe("sanitizeWorkspace", () => {
  test("allows only one safe file name", () => {
    assert.equal(sanitizeWorkspace("team_1.prod-logs"), "team_1.prod-logs");
    assert.throws(() => sanitizeWorkspace("../prod"), /workspace must match/);
    assert.throws(() => sanitizeWorkspace("Prod"), /workspace must match/);
    assert.throws(() => sanitizeWorkspace(""), /workspace must match/);
    assert.throws(() => sanitizeWorkspace(".."), /workspace must match/);
  });

  test("jsonlStore rejects unsafe workspace names before opening a path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-ledger-hardening-"));
    const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
    const store = jsonlStore(key, { dir: join(dir, "ledger") });

    await assert.rejects(
      () => store.append({ workspace: "../outside", at: "now", tool: "t", klass: "r1", decision: "allow", argsDigest: "a" }),
      /workspace must match/,
    );
  });
});

describe("development key file permissions", () => {
  test("new development keys are written 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-key-mode-"));

    await devKeyProvider({ dir, env: {} });

    const mode = (await stat(join(dir, "dev-ed25519.pkcs8"))).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  test("existing development keys with broad permissions are rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-key-wide-"));
    const file = join(dir, "dev-ed25519.pkcs8");
    await writeFile(file, "not a key");
    await chmod(file, 0o644);

    await assert.rejects(() => devKeyProvider({ dir, env: {} }), /permissions 0600/);
  });

  test("symbolic link key files are rejected before read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-key-link-"));
    const targetDir = await mkdtemp(join(tmpdir(), "void-key-target-"));
    const target = join(targetDir, "target.pkcs8");
    await writeFile(target, "not a key");
    await symlink(target, join(dir, "dev-ed25519.pkcs8"));

    await assert.rejects(() => assertPrivateKeyFileMode(join(dir, "dev-ed25519.pkcs8")), /symbolic link/);
    await assert.rejects(() => devKeyProvider({ dir, env: {} }), /symbolic link/);
  });
});
