/**
 * WP-03 verification runner: appends 1000 entries through the public API,
 * verifies the chain, then replays the plan's three tamper scenarios in a
 * scratch directory and prints the verdict for each. The forger attacks are
 * the point: a verifier that only ever sees intact chains proves nothing.
 *
 * Usage: node scripts/ledger-verify.mjs [--entries N]
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const ledger = await import(`${root}packages/ledger/src/index.ts`);

const entries = Number.parseInt(
  (
    process.argv.find((a) => a.startsWith("--entries=")) ?? "--entries=1000"
  ).split("=")[1],
  10,
);

const dir = await mkdtemp(join(tmpdir(), "void-ledger-run-"));
const keyDir = join(dir, "keys");
const signer = await ledger.devKeyProvider({ dir: keyDir, env: {} });
const workspace = "runner";

function store(sub) {
  return ledger.jsonlStore(signer, { dir: join(dir, sub) });
}

const bodies = [];
for (let index = 0; index < entries; index += 1) {
  bodies.push({
    workspace,
    tool: `demo.tool.${index % 37}`,
    args: { seq: index, note: "runner" },
  });
}

// 1. Append through the public API.
const main = store("main");
const started = Date.now();
for (const body of bodies) await main.append(body);
const appendMs = Date.now() - started;

// 2. Verify the intact chain.
const intact = await main.verify(workspace);

// 3. Tamper scenario A: edit a body, leave the hash.
const tamperDir = join(dir, "tamper");
const tamperStore = store("tamper");
for (const body of bodies.slice(0, 20)) await tamperStore.append(body);
const tamperFile = join(tamperDir, `${workspace}.jsonl`);
const tampered = (await readFile(tamperFile, "utf8"))
  .split("\n")
  .filter((l) => l !== "");
const parsed = JSON.parse(tampered[5]);
parsed.body.tool = "tampered.tool";
tampered[5] = JSON.stringify(parsed);
await writeFile(tamperFile, `${tampered.join("\n")}\n`);
const tamperResult = await ledger
  .jsonlStore(signer, { dir: tamperDir })
  .verify(workspace);

// 4. Tamper scenario B: delete an entry, leaving a link gap.
const dropDir = join(dir, "drop");
const dropStore = store("drop");
for (const body of bodies.slice(0, 20)) await dropStore.append(body);
const dropFile = join(dropDir, `${workspace}.jsonl`);
const dropped = (await readFile(dropFile, "utf8"))
  .split("\n")
  .filter((l) => l !== "");
dropped.splice(6, 1);
await writeFile(dropFile, `${dropped.join("\n")}\n`);
const dropResult = await ledger
  .jsonlStore(signer, { dir: dropDir })
  .verify(workspace);

// 5. Tamper scenario C: append with a forged signature.
const forgeDir = join(dir, "forge");
const forgeStore = store("forge");
for (const body of bodies.slice(0, 20)) await forgeStore.append(body);
const forgeFile = join(forgeDir, `${workspace}.jsonl`);
const forgedLines = (await readFile(forgeFile, "utf8"))
  .split("\n")
  .filter((l) => l !== "");
const last = JSON.parse(forgedLines[forgedLines.length - 1]);
const forgedBody = {
  workspace,
  tool: "evil.tool",
  args: { why: "disk owner" },
};
const hash = await ledger.entryHash(forgedBody, last.hash, ledger.sha256Hex);
const attacker = generateKeyPairSync("ed25519");
const preimage = ledger.signingPreimage("ed25519", last.key_id, hash);
const forgedSignature = cryptoSign(null, preimage, attacker.privateKey);
forgedLines.push(
  JSON.stringify({
    workspace,
    seq: last.seq + 1,
    body: forgedBody,
    prev_hash: last.hash,
    hash,
    key_id: last.key_id,
    alg: "ed25519",
    signature: `ed25519:${Buffer.from(forgedSignature).toString("base64")}`,
  }),
);
await writeFile(forgeFile, `${forgedLines.join("\n")}\n`);
const forgeResult = await ledger
  .jsonlStore(signer, { dir: forgeDir })
  .verify(workspace);

// 6. Report.
const fmt = (r) =>
  `${r.ok ? "intact" : "CAUGHT"} ${r.checked} checked${r.reason ? `: ${r.reason}` : ""}`;
console.log(
  `appended   ${entries} entries in ${appendMs}ms (${Math.round(entries / (appendMs / 1000))}/s)`,
);
console.log(
  `intact     ${intact.ok ? "chain intact, signatures valid" : "UNEXPECTED FAILURE"} (${intact.checked} checked)`,
);
console.log(`tamper     ${fmt(tamperResult)}`);
console.log(`drop       ${fmt(dropResult)}`);
console.log(`forge      ${fmt(forgeResult)}`);

const pass =
  intact.ok &&
  intact.checked === entries &&
  !tamperResult.ok &&
  tamperResult.reason.includes("body") &&
  !dropResult.ok &&
  (dropResult.reason.includes("link") || dropResult.reason.includes("order")) &&
  !forgeResult.ok &&
  forgeResult.reason.includes("signature");

console.log(pass ? "VERDICT: PASS" : "VERDICT: FAIL");
process.exit(pass ? 0 : 1);
