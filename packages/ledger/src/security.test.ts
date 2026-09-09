import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { devKeyProvider } from "./sign.ts";
import { jsonlStore } from "./store.ts";
import { attestLedger, merkleDigest } from "./attest.ts";
import { verifyChain } from "./verify.ts";

test("unreadable ledger is not verified as an empty chain", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-security-ledger-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  await mkdir(join(dir, "blocked.jsonl"));
  await assert.rejects(store.verify("blocked"));
  await assert.rejects(store.head("blocked"));
});

test("a missing workspace can still start an empty ledger", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-security-ledger-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  assert.deepEqual(await store.verify("new"), { ok: true, checked: 0 });
  await store.append({ workspace: "new" });
  assert.deepEqual(await store.verify("new"), { ok: true, checked: 1 });
});

test("unsigned workspace relabeling cannot change signed ledger ownership", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-security-ledger-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  const entry = await store.append({ workspace: "source" });
  const relabeled = { ...entry, workspace: "target" };
  const verified = await verifyChain([relabeled], { publicKey: (id) => key.publicKey(id) });
  assert.equal(verified.ok, false);
  await writeFile(join(dir, "target.jsonl"), `${JSON.stringify(relabeled)}\n`);
  assert.equal((await store.verify("target")).ok, false);
  await assert.rejects(attestLedger(dir, "target", key));
});

test("copying a valid ledger into another workspace cannot mint an attestation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-security-ledger-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(key, { dir });
  const entry = await store.append({ workspace: "source" });
  await writeFile(join(dir, "target.jsonl"), `${JSON.stringify(entry)}\n`);
  assert.equal((await store.verify("target")).ok, false);
  await assert.rejects(attestLedger(dir, "target", key));
});

test("merkle digest retains entry order", async () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  assert.notEqual(await merkleDigest([a, b]), await merkleDigest([b, a]));
});
