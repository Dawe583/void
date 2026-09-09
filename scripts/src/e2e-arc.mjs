#!/usr/bin/env node
// Whole-product arc moment: one script drives every public surface in a single story.
// The arc runs the proxy through the SDK (VoidClient keeps the proxy in-process and owns
// an ApprovalBroker), attaches the control-plane HTTP server to that same broker object,
// and resolves a held destructive call through the operator surface. It then reads the
// resulting history through the void CLI and closes with a tamper-and-verify-fail proof.
// Every surface is the real one: no injected fakes, no shortened paths.

import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

import { createVoidClient } from "../../packages/sdk/src/index.ts";
import { listenControlPlane } from "../../apps/control-plane/api/server.ts";
import { devKeyProvider } from "../../packages/ledger/src/sign.ts";

const root = new URL("../..", import.meta.url).pathname;
const fixturesPolicy = join(root, "fixtures", "e2e-policy.yaml");
const fixturesUpstream = join(root, "fixtures", "e2e-server.mjs");

// The strict facts parser wants every known key present with evidence, so wrap the shared
// fixture values exactly like the shipped e2e-final moment does.
const rawFacts = JSON.parse(await readFile(join(root, "fixtures", "facts.json"), "utf8"));
const strictFacts = {};
for (const [name, value] of Object.entries(rawFacts)) {
  strictFacts[name] = { value, verifiedAt: "2026-09-08T00:00:00Z", source: "fixture" };
}
async function strictFactsPath(dir) {
  const path = join(dir, "facts.json");
  await writeFile(path, `${JSON.stringify({ facts: strictFacts })}\n`);
  return path;
}

const passLines = [];
const failures = [];

function pass(name) { passLines.push(`PASS ${name}`); console.log(`PASS ${name}`); }

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    failures.push(`FAIL ${name}: ${error && error.stack ? error.stack : String(error)}`);
    console.error(`FAIL ${name}: ${error && error.stack ? error.stack : String(error)}`);
  }
}

function runCli(args, env) {
  const child = spawn(process.execPath, ["packages/cli/bin/void.mjs", ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  return new Promise((resolve) => {
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

async function runArcMoment() {
  const base = await mkdtemp(join(tmpdir(), "void-arc-"));
  const home = join(base, "home");
  const ledgerDir = join(base, "ledger");
  const workspace = "arc-workspace";
  const env = { ...process.env, HOME: home, VOID_WORKSPACE: workspace };

  // One run-scoped signing key: the in-process proxy and every void CLI child must agree.
  // devKeyProvider prefers VOID_SIGNING_KEY, so the same base64 pkcs8 goes to both.
  await devKeyProvider({ dir: join(base, "keys"), env: {} });
  const signingKey = (await readFile(join(base, "keys", "dev-ed25519.pkcs8"))).toString("base64");
  process.env.VOID_SIGNING_KEY = signingKey;
  env.VOID_SIGNING_KEY = signingKey;

  // Agent-side consumer: the SDK runs the proxy in-process over the fixture upstream.
  const client = createVoidClient({
    ledgerDir,
    workspace,
    connect: { upstreamCommand: [process.execPath, fixturesUpstream] },
    policyPath: fixturesPolicy,
    factsPath: await strictFactsPath(base),
    posture: "fail-closed",
  });
  // Operator surface: the control-plane reads and decides through the client's live broker.
  const plane = await listenControlPlane({ approvals: client.approvals });

  let feedBefore = null;
  let decisionResponse = null;
  let approvedRecord = null;
  let denyResult = null;
  try {
    // 1. Agent asks for the tool list through the proxy.
    const tools = await client.request("tools/list");
    assert.ok(Array.isArray(tools.tools) && tools.tools.some((t) => t.name === "orders_delete"),
      "tools/list reaches the upstream through the proxy");

    // 2. Agent issues the destructive call; policy holds it.
    const heldPromise = client.request("tools/call", { name: "orders_delete", arguments: { where: "id = 7" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pending = client.pendingHolds();
    assert.equal(pending.length, 1, "exactly one held call is pending");
    const holdId = pending[0].holdId;
    assert.equal(pending[0].call.tool, "orders_delete", "the held call is the destructive tool");

    // 3. Operator sees the same hold through the control-plane API.
    const listRes = await fetch(`http://127.0.0.1:${plane.port}/api/approvals`);
    assert.equal(listRes.status, 200, "approvals endpoint answers");
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.approvals) && listBody.approvals.some((a) => a.holdId === holdId),
      "the control-plane lists the held call the agent triggered");

    // 4. Operator approves through the control-plane decision endpoint.
    const decRes = await fetch(`http://127.0.0.1:${plane.port}/api/approvals/${holdId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "approved", by: "arc-operator", reason: "arc moment" }),
    });
    decisionResponse = { status: decRes.status, body: await decRes.json() };
    assert.equal(decRes.status, 200, "decision endpoint accepts the approval");
    assert.ok(decisionResponse.body.ok !== false, "decision endpoint reports success");

    // 5. The held call resolves: the upstream really executes it.
    const result = await heldPromise;
    assert.equal(result.content[0].text, "deleted 1", "approved call executes upstream for real");

    // 6. The SDK hold view agrees: awaitHold resolves to the upstream result and the broker
    // retains the decided record with attribution.
    const holdResult = await client.awaitHold(holdId);
    assert.equal(holdResult.content[0].text, "deleted 1", "awaitHold resolves to the upstream result");
    approvedRecord = client.approvals.get(holdId);
    assert.equal(approvedRecord.status, "approved", "SDK sees the approved record");
    assert.equal(approvedRecord.by, "arc-operator", "decision attribution survives the broker round trip");

    // 7. Ledger arc through the real void CLI: verify, feed, taint.
    const ledgerFile = join(ledgerDir, `${workspace}.jsonl`);
    const verify = await runCli(["verify", "--ledger", ledgerDir], env);
    assert.equal(verify.code, 0, `void verify exits 0 (stderr: ${verify.err.slice(0, 200)})`);
    assert.match(verify.out, /chain: \d+ entries ok/, "verify reports an intact chain");
    const feed = await runCli(["feed", "--ledger", ledgerFile, "--json"], env);
    assert.equal(feed.code, 0, "void feed exits 0");
    const page = JSON.parse(feed.out.trim());
    assert.equal(page.verified, true, "feed page carries verification");
    const approvedRow = page.records.find((r) => r.decision === "hold:approved" && r.tool === "orders_delete");
    assert.ok(approvedRow, "ledger records the approved hold for the destructive call");
    const taint = await runCli(["taint", "--ledger", ledgerDir, "--seq", String(approvedRow.seq)], env);
    assert.equal(taint.code, 0, "void taint exits 0");
    assert.ok(taint.out.includes("orders_delete"), "taint names the touched tool");

    // 8. A second destructive call denied through the control-plane must not execute upstream.
    const denyPromise = client.request("tools/call", { name: "orders_delete", arguments: { where: "id = 9" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pendingTwo = client.pendingHolds();
    assert.equal(pendingTwo.length, 1, "second call holds");
    const denyRes = await fetch(`http://127.0.0.1:${plane.port}/api/approvals/${pendingTwo[0].holdId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "denied", by: "arc-operator", reason: "arc moment" }),
    });
    assert.equal(denyRes.status, 200, "denial accepted");
    await assert.rejects(denyPromise, (error) => {
      assert.ok(error instanceof Error, "denied call rejects with an Error");
      denyResult = error.message;
      return true;
    }, "denied call rejects");
    const feedTwo = await runCli(["feed", "--ledger", ledgerFile, "--json"], env);
    const rowsTwo = JSON.parse(feedTwo.out.trim()).records;
    assert.ok(rowsTwo.some((r) => r.decision === "hold:denied"), "ledger records the denial");

    // 9. Tamper with the closed chain on a copy: verification must fail loudly.
    const tamperedFile = join(base, "tampered.jsonl");
    const original = await readFile(ledgerFile, "utf8");
    const tamperedText = original.replace("hold:approved", "hold:xpproved");
    assert.notEqual(tamperedText, original, "tamper changed the ledger text");
    await writeFile(tamperedFile, tamperedText);
    const verifyBad = await runCli(["verify", "--ledger", tamperedFile], env);
    assert.notEqual(verifyBad.code, 0, "tampered ledger fails verification");
  } finally {
    client.close();
    await plane.close();
    await rm(base, { recursive: true, force: true });
  }
  void feedBefore;
  void decisionResponse;
  void approvedRecord;
  void denyResult;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("all")) {
    console.error("usage: node scripts/src/e2e-arc.mjs all");
    process.exitCode = 2;
  } else {
    await check("whole product arc moment", runArcMoment);
    if (failures.length > 0) process.exitCode = 1;
  }
}

export { runArcMoment, passLines, failures };
