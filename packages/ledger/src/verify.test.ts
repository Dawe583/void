import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devKeyProvider } from "./sign.ts";
import { jsonlStore } from "./store.ts";
import { verifyLedgerFile } from "./verify.ts";

const workspace = "verify-ws";

type Body = {
  readonly workspace: string;
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
};

async function seedLedger(): Promise<{
  readonly dir: string;
  readonly file: string;
  readonly key: Awaited<ReturnType<typeof devKeyProvider>>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "void-verify-"));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  for (let index = 1; index <= 4; index += 1) {
    const body: Body = {
      workspace,
      at: `2026-09-0${index}T00:00:00.000Z`,
      tool: `postgres.row.update.${index}`,
      klass: "r1",
      decision: "allow:resolved",
      argsDigest: `${index}`.repeat(64),
    };
    await store.append(body);
  }
  return { dir, file: join(dir, `${workspace}.jsonl`), key };
}

describe("verifyLedgerFile", () => {
  test("verifies an exported JSONL file with the public key only", async () => {
    const { file, key } = await seedLedger();
    const keyId = await key.currentKeyId();
    const publicKey = await key.publicKey(keyId);
    assert.ok(publicKey !== null);
    const result = await verifyLedgerFile(file, { publicKey });
    assert.equal(result.ok, true);
    assert.equal(result.checked, 4);
    assert.equal(result.lines.length, 4);
    assert.equal(result.lines.every((line) => line.ok), true);
  });

  test("a tampered middle hash fails with the seq named", async () => {
    const { file, key } = await seedLedger();
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    const second = JSON.parse(lines[1]!) as { hash: string };
    second.hash = "f".repeat(64);
    lines[1] = JSON.stringify(second);
    await writeFile(file, `${lines.join("\n")}\n`);
    const keyId = await key.currentKeyId();
    const publicKey = await key.publicKey(keyId);
    assert.ok(publicKey !== null);

    const result = await verifyLedgerFile(file, { publicKey });
    assert.equal(result.ok, false);
    assert.equal(result.checked, 2);
    assert.match(result.reason!, /entry 2/);
  });

  test("the wrong public key fails signature verification", async () => {
    const { file } = await seedLedger();
    const wrongDir = await mkdtemp(join(tmpdir(), "void-wrong-key-"));
    const wrongKey = await devKeyProvider({ dir: wrongDir, env: {} });
    const wrongKeyId = await wrongKey.currentKeyId();
    const publicKey = await wrongKey.publicKey(wrongKeyId);
    assert.ok(publicKey !== null);

    const result = await verifyLedgerFile(file, { publicKey });
    assert.equal(result.ok, false);
    assert.match(result.reason!, /signature verification/);
  });
});
