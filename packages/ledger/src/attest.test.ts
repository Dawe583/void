import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attestLedger, storeAttestation, verifyAttestation, merkleDigest } from "./attest.ts";
import { devKeyProvider } from "./sign.ts";
import { jsonlStore } from "./store.ts";
import { readLedgerEntries } from "./verify.ts";

const workspace = "attest-ws";

type Body = {
  readonly workspace: string;
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
};

async function seedLedger(): Promise<{ readonly dir: string; readonly key: Awaited<ReturnType<typeof devKeyProvider>> }> {
  const dir = await mkdtemp(join(tmpdir(), "void-attest-"));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  for (let index = 1; index <= 3; index += 1) {
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
  return { dir, key };
}

describe("attestLedger", () => {
  test("signs the current ledger head and stores the document", async () => {
    const { dir, key } = await seedLedger();
    const doc = await attestLedger(dir, workspace, key, {
      now: () => new Date("2026-09-08T00:00:00.000Z"),
    });
    const entries = await readLedgerEntries(join(dir, `${workspace}.jsonl`));
    assert.equal(doc.workspace, workspace);
    assert.equal(doc.headSeq, 3);
    assert.equal(doc.entriesCount, 3);
    assert.equal(doc.headHash, entries[2]!.hash);
    assert.equal(doc.treeDigest, await merkleDigest(entries.map((entry) => entry.hash)));
    assert.match(doc.signature, /^ed25519:/);

    const path = await storeAttestation(dir, doc);
    const stored = JSON.parse(await readFile(path, "utf8")) as typeof doc;
    assert.deepEqual(stored, doc);

    const result = await verifyAttestation(doc, entries, {
      publicKey: (keyId) => key.publicKey(keyId),
    });
    assert.deepEqual(result, { ok: true });
  });

  test("attestation verification names a tree mismatch", async () => {
    const { dir, key } = await seedLedger();
    const doc = await attestLedger(dir, workspace, key);
    const entries = await readLedgerEntries(join(dir, `${workspace}.jsonl`));
    const result = await verifyAttestation({ ...doc, treeDigest: "f".repeat(64) }, entries, {
      publicKey: (keyId) => key.publicKey(keyId),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /tree digest mismatch/);
  });
});
