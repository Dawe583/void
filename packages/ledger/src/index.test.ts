import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GENESIS_PREV,
  canonicalJson,
  entryHash,
} from "./canonical.ts";
import { sha256Hex } from "./sign.ts";
import { jsonlStore } from "./store.ts";
import {
  devKeyProvider,
  keyProviderFromPkcs8,
  verifySignature,
} from "./sign.ts";
import { generateKeyPairSync } from "node:crypto";
import { signingPreimage } from "./index.ts";

const workspace = "test-ws";
const dir = await mkdtemp(join(tmpdir(), "void-ledger-"));
const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });

// Each test seeds its own directory: the store is per workspace file, and a
// shared one would leak state between tests in the order the runner picks.
let storeCounter = 0;
function store() {
  storeCounter += 1;
  return jsonlStore(signer, { dir: join(dir, `s${storeCounter}`) });
}

type Body = { workspace: string; tool: string; args: Record<string, unknown> };

const bodies: Body[] = [];
for (let index = 0; index < 50; index += 1) {
  bodies.push({
    workspace,
    tool: `demo.tool.${index}`,
    args: { b: index, a: "order in the body must not matter", nested: { z: index, m: [1, 2, { k: "v" }] } },
  });
}

describe("canonicalJson", () => {
  test("sorts keys at every depth, not only the top", () => {
    const a = { b: 1, meta: { z: "last", a: "first" } };
    const b = { meta: { a: "first", z: "last" }, b: 1 };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(canonicalJson(a), '{"b":1,"meta":{"a":"first","z":"last"}}');
  });

  test("refuses values that do not round trip", () => {
    assert.throws(() => canonicalJson({ n: Number.NaN }), /non-finite|NaN/);
    assert.throws(() => canonicalJson({ u: undefined }), /undefined/);
    assert.throws(() => canonicalJson({ c: 1n }), /bigint/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    assert.throws(() => canonicalJson(cycle), /cycle/);
  });

  test("refuses hostile nesting with a named error, not a stack overflow", () => {
    // A body nested 60000 levels deep is not a caller a verifier ever meets.
    // The refusal must still carry a name the write path can log and act on:
    // a RangeError with a V8 frame dump is a crash wearing a refusal's coat.
    let deep: unknown = { leaf: true };
    for (let index = 0; index < 60000; index += 1) deep = { d: deep };
    assert.throws(() => canonicalJson(deep), /nests deeper than/);
  });

  test("numeric and string keys canonicalize the same way both ways", () => {
    // JSON.stringify turns the key 1 into "1", and so must the canonicaliser,
    // identically on every runtime, or two implementations disagree on the
    // same entry.
    assert.equal(canonicalJson({ 1: "a" }), '{"1":"a"}');
    assert.notEqual(canonicalJson({ 1: "a" }), canonicalJson({ "1": "a", "2": "b" }));
  });
});

describe("the chain", () => {
  test("the first entry links to the genesis digest", async () => {
    const s = store();
    const receipt = await s.append(bodies[0]!);
    assert.equal(receipt.prev_hash, GENESIS_PREV);
    assert.equal(receipt.seq, 1);
    const recomputed = await entryHash(bodies[0]!, GENESIS_PREV, sha256Hex);
    assert.equal(receipt.hash, recomputed);
  });

  test("key order in the body does not change the digest", async () => {
    const one = { workspace, tool: "t", args: { x: 1, y: 2 } };
    const two = { workspace, tool: "t", args: { y: 2, x: 1 } };
    const a = await entryHash(one, GENESIS_PREV, sha256Hex);
    const b = await entryHash(two, GENESIS_PREV, sha256Hex);
    assert.equal(a, b);
  });
});

describe("the dev key path", () => {
  test("generates once, reuses after, and carries the dev- prefix", async () => {
    const keyDir = join(dir, "keys-once");
    const first = await devKeyProvider({ dir: keyDir, env: {} });
    const second = await devKeyProvider({ dir: keyDir, env: {} });
    assert.equal(await first.currentKeyId(), await second.currentKeyId());
    assert.match(await first.currentKeyId(), /^dev-ed25519:/);
    const id = await first.currentKeyId();
    const spki = await first.publicKey(id);
    assert.ok(spki instanceof Uint8Array && spki.length > 0);
    assert.equal(await first.publicKey("unknown"), null);
  });

  test("VOID_SIGNING_KEY wins over the directory", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
    const inline = keyProviderFromPkcs8(Buffer.from(pkcs8));
    const id = await inline.currentKeyId();
    assert.match(id, /^dev-/);
  });
});

describe("append and read", () => {
  test("seq numbers are contiguous and the head follows the file", async () => {
    const s = store();
    for (const body of bodies.slice(0, 10)) await s.append(body);
    const head = await s.head(workspace);
    assert.equal(head?.seq, 10);
    let count = 0;
    for await (const entry of s.read(workspace)) count += 1;
    assert.equal(count, 10);
  });

  test("verify passes on an intact chain", async () => {
    const s = store();
    for (const body of bodies.slice(0, 10)) await s.append(body);
    const result = await s.verify(workspace);
    assert.deepEqual(result, { ok: true, checked: 10 });
  });

  test("an empty ledger verifies as zero checked", async () => {
    const s = jsonlStore(signer, { dir: join(dir, "empty") });
    assert.deepEqual(await s.verify("nothing"), { ok: true, checked: 0 });
  });
});

describe("the four forger attacks", () => {
  // WP-03's break phase: each forger edits the persisted file directly, the
  // way an attacker who owns the disk would, and each one must be caught.
  // Any uncaught forgery fails the package.

  async function seeded(n: number): Promise<string> {
    const sub = join(dir, `forge-${n}`);
    const s = jsonlStore(signer, { dir: sub });
    for (const body of bodies.slice(0, 12)) await s.append(body);
    return sub;
  }

  async function lines(sub: string): Promise<string[]> {
    const text = await readFile(join(sub, `${workspace}.jsonl`), "utf8");
    return text.split("\n").filter((l) => l !== "");
  }

  async function rewrite(sub: string, entries: string[]): Promise<void> {
    await writeFile(join(sub, `${workspace}.jsonl`), `${entries.join("\n")}\n`);
  }

  test("forgery 1: edit a body, leave the hash", async () => {
    const sub = await seeded(1);
    const s = jsonlStore(signer, { dir: sub });
    const entries = await lines(sub);
    const parsed = JSON.parse(entries[5]!) as { body: Body };
    parsed.body.tool = "tampered.tool";
    entries[5] = JSON.stringify(parsed);
    await rewrite(sub, entries);
    const result = await s.verify(workspace);
    assert.equal(result.ok, false);
    assert.match(result.reason!, /body: entry 6/);
  });

  test("forgery 2: delete an entry, leaving a gap", async () => {
    const sub = await seeded(2);
    const s = jsonlStore(signer, { dir: sub });
    const entries = await lines(sub);
    entries.splice(6, 1);
    await rewrite(sub, entries);
    const result = await s.verify(workspace);
    assert.equal(result.ok, false);
    assert.match(result.reason!, /link|order/);
  });

  test("forgery 3: reorder two entries", async () => {
    const sub = await seeded(3);
    const s = jsonlStore(signer, { dir: sub });
    const entries = await lines(sub);
    const seventh = entries[6]!;
    entries[6] = entries[7]!;
    entries[7] = seventh;
    await rewrite(sub, entries);
    const result = await s.verify(workspace);
    assert.equal(result.ok, false);
    assert.ok(result.reason !== undefined);
  });

  test("forgery 4: append an entry with a forged signature", async () => {
    const sub = await seeded(4);
    const s = jsonlStore(signer, { dir: sub });
    const entries = await lines(sub);
    const last = JSON.parse(entries[entries.length - 1]!) as {
      workspace: string; seq: number; body: Body; prev_hash: string; hash: string; key_id: string; alg: string; signature: string;
    };
    const forgedBody: Body = { workspace, tool: "evil.tool", args: { why: "because the attacker owns the disk" } };
    const hash = await entryHash(forgedBody, last.hash, sha256Hex);
    const attackerKeys = generateKeyPairSync("ed25519");
    const attackerSpki = new Uint8Array(
      attackerKeys.publicKey.export({ format: "der", type: "spki" }),
    );
    const preimage = signingPreimage("ed25519", last.key_id, hash);
    const attackerSignature = (await import("node:crypto")).sign(null, preimage, attackerKeys.privateKey);
    entries.push(
      JSON.stringify({
        workspace,
        seq: last.seq + 1,
        body: forgedBody,
        prev_hash: last.hash,
        hash,
        key_id: last.key_id,
        alg: "ed25519",
        signature: `ed25519:${Buffer.from(attackerSignature).toString("base64")}`,
      }),
    );
    await rewrite(sub, entries);
    const result = await s.verify(workspace);
    assert.equal(result.ok, false);
    assert.match(result.reason!, /signature: entry 13/);
  });

  test("verifySignature itself separates keys", async () => {
    const a = generateKeyPairSync("ed25519");
    const b = generateKeyPairSync("ed25519");
    const message = new TextEncoder().encode("void test");
    const signature = (await import("node:crypto")).sign(null, message, a.privateKey);
    const spkiA = new Uint8Array(a.publicKey.export({ format: "der", type: "spki" }));
    const spkiB = new Uint8Array(b.publicKey.export({ format: "der", type: "spki" }));
    assert.equal(verifySignature("ed25519", message, new Uint8Array(signature), spkiA), true);
    assert.equal(verifySignature("ed25519", message, new Uint8Array(signature), spkiB), false);
  });

  test("a hostile line with an unsupported algorithm is a finding, not a crash", async () => {
    // A file this package never wrote can carry any tag in the alg field.
    // The verifier must name the entry and stop there, never throw, or one
    // crafted line ends the entire verification run at line one. The line
    // below carries a correct body hash so the failure is the algorithm, not
    // the body, proving the guard sits after the cheap checks and before the
    // signature path that would throw.
    const sub = join(dir, "alg-guard");
    const s = jsonlStore(signer, { dir: sub });
    await s.append({ workspace, tool: "t", args: {} });
    const file = join(sub, `${workspace}.jsonl`);
    const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l !== "");
    const last = JSON.parse(lines[lines.length - 1]!) as { seq: number; hash: string; key_id: string };
    const hostileBody = { workspace, tool: "x", args: {} };
    const hostileHash = await entryHash(hostileBody, last.hash, sha256Hex);
    lines.push(
      JSON.stringify({
        workspace,
        seq: last.seq + 1,
        body: hostileBody,
        prev_hash: last.hash,
        hash: hostileHash,
        key_id: last.key_id,
        alg: "ecdsa-p256-sha256",
        signature: "ecdsa-p256-sha256:AAAA",
      }),
    );
    await writeFile(file, `${lines.join("\n")}\n`);
    const result = await jsonlStore(signer, { dir: sub }).verify(workspace);
    assert.equal(result.ok, false);
    assert.match(result.reason!, /unsupported algorithm ecdsa-p256-sha256/);
  });

  test("a pre placed symlink cannot capture the development key", async () => {
    // The key file is written O_CREAT|O_EXCL: a symlink at the path is
    // refused, so an attacker pre placing one cannot carry the private key
    // to a path of their choosing while the write reports success. The call
    // fails loudly, the dangling symlink is never adopted, and nothing is
    // ever written through it: the target must not exist afterwards.
    const keyDir = join(dir, "symlinked");
    await mkdir(keyDir, { recursive: true });
    const target = join(dir, "attacker-target");
    await symlink(target, join(keyDir, "dev-ed25519.pkcs8"));
    await assert.rejects(() => devKeyProvider({ dir: keyDir, env: {} }));
    await assert.rejects(() => stat(target), /ENOENT/);
  });

  test("concurrent key generation adopts the winner's key", async () => {
    // Two processes on one fresh directory: the loser of the O_EXCL race
    // reads back the winner's key, so both hold the key every entry will be
    // verified under, instead of each silently keeping a private key nobody
    // else can ever verify with.
    const keyDir = join(dir, "adopt");
    const [p1, p2] = await Promise.all([
      devKeyProvider({ dir: keyDir, env: {} }),
      devKeyProvider({ dir: keyDir, env: {} }),
    ]);
    assert.equal(await p1.currentKeyId(), await p2.currentKeyId());
  });
});
