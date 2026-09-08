import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attestLedger, storeAttestation } from "../../ledger/src/attest.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import { jsonlStore } from "../../ledger/src/store.ts";
import { runVerifyCommand } from "./verify.ts";

const workspace = "verify-cli-ws";

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
  readonly publicKey: Uint8Array;
  readonly key: Awaited<ReturnType<typeof devKeyProvider>>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "void-cli-verify-"));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  for (let index = 1; index <= 2; index += 1) {
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
  const keyId = await key.currentKeyId();
  const publicKey = await key.publicKey(keyId);
  assert.ok(publicKey !== null);
  return { dir, file: join(dir, `${workspace}.jsonl`), publicKey, key };
}

describe("runVerifyCommand", () => {
  test("verifies an export file without the live ledger dir", async () => {
    const { file, publicKey } = await seedLedger();
    const exportDir = await mkdtemp(join(tmpdir(), "void-export-only-"));
    const exportFile = join(exportDir, "export.jsonl");
    await writeFile(exportFile, await readFile(file, "utf8"));
    const out: string[] = [];
    const err: string[] = [];
    const code = await runVerifyCommand(
      ["--file", exportFile],
      { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
      { publicKey },
    );

    assert.equal(code, 0);
    assert.equal(err.length, 0);
    assert.match(out.join("\n"), /seq 1: ok/);
    assert.match(out.join("\n"), /chain: 2 entries ok/);
    assert.match(out.join("\n"), /attestation: not checked/);
  });

  test("checks an attestation match", async () => {
    const { dir, file, publicKey, key } = await seedLedger();
    const doc = await attestLedger(dir, workspace, key);
    const attestationPath = await storeAttestation(dir, doc);
    const out: string[] = [];
    const code = await runVerifyCommand(
      ["--file", file, "--attestation", attestationPath],
      { stdout: (line) => out.push(line), stderr: () => {} },
      { publicKey },
    );

    assert.equal(code, 0);
    assert.match(out.join("\n"), /attestation: match/);
  });

  test("a missing attestation exits one", async () => {
    const { file, publicKey } = await seedLedger();
    const err: string[] = [];
    const code = await runVerifyCommand(
      ["--file", file, "--attestation", "missing.json"],
      { stdout: () => {}, stderr: (line) => err.push(line) },
      { publicKey },
    );

    assert.equal(code, 1);
    assert.match(err.join("\n"), /void verify failed/);
  });

  test("an attestation mismatch exits one", async () => {
    const { dir, file, publicKey, key } = await seedLedger();
    const doc = await attestLedger(dir, workspace, key);
    const attestationPath = join(dir, "bad-attestation.json");
    await writeFile(attestationPath, JSON.stringify({ ...doc, entriesCount: 99 }));
    const out: string[] = [];
    const code = await runVerifyCommand(
      ["--file", file, "--attestation", attestationPath],
      { stdout: (line) => out.push(line), stderr: () => {} },
      { publicKey },
    );

    assert.equal(code, 1);
    assert.match(out.join("\n"), /attestation: mismatch/);
  });
});
