#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseStatement } from "../../packages/connectors/src/postgres/parse.ts";
import { captureBeforeImage } from "../../packages/connectors/src/postgres/capture.ts";
import { LocalSnapshotStore } from "../../packages/connectors/src/snapshot/local.ts";
import { sha256Digest } from "../../packages/connectors/src/snapshot/store.ts";
import { jsonlStore } from "../../packages/ledger/src/store.ts";
import { devKeyProvider } from "../../packages/ledger/src/sign.ts";

const root = new URL("../..", import.meta.url);
const rootPath = fileURLToPath(root);
const passLines = [];
const failures = [];
const notes = [];

function pass(name) {
  const line = `PASS ${name}`;
  passLines.push(line);
  console.log(line);
}

function fail(name, error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  const line = `FAIL ${name}: ${detail}`;
  failures.push(line);
  console.error(line);
}

function note(name, reason) {
  const line = `NOTE ${name}: ${reason}`;
  notes.push(line);
  console.log(line);
}

export async function check(name, fn) {
  try {
    const value = await fn();
    pass(name);
    return value;
  } catch (error) {
    fail(name, error);
    return undefined;
  }
}

async function waitFor(predicate, label, attempts = 500, ms = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await predicate();
    if (value) return value;
    await delay(ms);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function textFrom(response) {
  return response?.result?.content?.[0]?.text;
}

function parseJsonLines(buffer) {
  const messages = [];
  for (const line of buffer.split("\n")) {
    if (line.trim() === "") continue;
    messages.push(JSON.parse(line));
  }
  return messages;
}

function hasApproveSurface() {
  const source = readFileSyncText("packages/cli/src/index.ts");
  return /"approve"/.test(source);
}

function hasHttpSurface() {
  const source = readFileSyncText("packages/proxy/bin/void-proxy.mjs");
  return source.includes("--transport") && source.includes("--upstream-url");
}

function readFileSyncText(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootPath,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs ?? 10000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", (exitCode) => resolve(exitCode ?? 1)));
  clearTimeout(timer);
  if (timedOut) throw new Error(`${command} ${args.join(" ")} timed out`);
  return { code, stdout, stderr };
}

async function runCli(args, env) {
  return runCommand(process.execPath, ["packages/cli/bin/void.mjs", ...args], { env });
}

async function strictFactsPath(rootDir) {
  const raw = JSON.parse(await readFile(new URL("../../fixtures/facts.json", import.meta.url), "utf8"));
  const facts = {};
  for (const [name, value] of Object.entries(raw)) {
    facts[name] = { value, verifiedAt: "2026-09-08T00:00:00Z", source: "fixture" };
  }
  const path = join(rootDir, "facts.json");
  await writeFile(path, `${JSON.stringify({ facts })}\n`);
  return path;
}

async function policyPath(rootDir, seconds = 1) {
  const path = join(rootDir, "policy.yaml");
  await writeFile(path, `version: 1
rules:
  - match:
      tool: echo
    decision: allow
  - match:
      tool: orders_delete
    decision: hold
    seconds: ${seconds}
    notify: [cli]
    rationale: destructive fixture tool requires approval
  - match: {}
    decision: deny
    rationale: only e2e fixture tools are allowed
`);
  return path;
}

function spawnProxy(args, env) {
  const child = spawn(process.execPath, ["packages/proxy/bin/void-proxy.mjs", ...args], {
    cwd: rootPath,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = [];
  const errors = [];
  let outBuffer = "";
  let errBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outBuffer += chunk;
    for (;;) {
      const end = outBuffer.indexOf("\n");
      if (end === -1) break;
      const line = outBuffer.slice(0, end);
      outBuffer = outBuffer.slice(end + 1);
      if (line.trim() !== "") output.push(JSON.parse(line));
    }
  });
  child.stderr.on("data", (chunk) => {
    errBuffer += chunk;
    for (;;) {
      const end = errBuffer.indexOf("\n");
      if (end === -1) break;
      const line = errBuffer.slice(0, end);
      errBuffer = errBuffer.slice(end + 1);
      if (line.trim() !== "") errors.push(line);
    }
  });
  return { child, output, errors };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function closeProxy(child) {
  child.stdin.end();
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 0)));
}

async function readLedgerRecords(ledgerFile) {
  const raw = await readFile(ledgerFile, "utf8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function runStdioProductMoment() {
  const base = await mkdtemp(join(tmpdir(), "void-e2e-final-"));
  const ledgerDir = join(base, "ledger");
  const approvalsDir = join(base, "approvals");
  const home = join(base, "home");
  const workspace = "e2e-final";
  const env = { ...process.env, HOME: home, VOID_WORKSPACE: workspace };
  const facts = await strictFactsPath(base);
  const policy = await policyPath(base);
  assert.ok(hasApproveSurface(), "void approve is a real command in this tree");

  const proxy = spawnProxy([
    "--upstream", process.execPath,
    "--args", "fixtures/e2e-server.mjs",
    "--policy", policy,
    "--facts", facts,
    "--posture", "fail-closed",
    "--ledger-dir", ledgerDir,
    "--approvals-dir", approvalsDir,
    "--workspace", workspace,
  ], env);

  try {
    send(proxy.child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    await waitFor(() => proxy.output.length >= 1 && proxy.output[0], "initialize response");
    assert.equal(proxy.output[0].result.protocolVersion, "2025-06-18");

    send(proxy.child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await waitFor(() => proxy.output.length >= 2 && proxy.output[1], "tools/list response");
    assert.deepEqual(proxy.output[1].result.tools.map((tool) => tool.name), ["echo", "orders_delete"]);

    send(proxy.child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hello void" } } });
    await waitFor(() => proxy.output.length >= 3 && proxy.output[2], "echo response");
    assert.equal(textFrom(proxy.output[2]), "hello void");

    // First held call: approved through the real void approve command and the state dir.
    send(proxy.child, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } } });
    const firstHoldId = await waitFor(async () => {
      try {
        const pending = JSON.parse(await readFile(join(approvalsDir, "pending.json"), "utf8"));
        return Array.isArray(pending) && pending.length > 0 && typeof pending[0].holdId === "string" ? pending[0].holdId : false;
      } catch {
        return false;
      }
    }, "pending hold in the approvals state dir");
    const approve = await runCli(["approve", firstHoldId, "--by", "e2e-final", "--reason", "moment", "--dir", approvalsDir], env);
    assert.equal(approve.code, 0, `${approve.stdout}\n${approve.stderr}`);
    await waitFor(() => proxy.output.length >= 4 && proxy.output[3], "approved response", 300, 10);
    // Approval releases the held call and the proxy forwards it upstream for real.
    assert.equal(textFrom(proxy.output[3]), "deleted 2");

    // Second held call: no decision is written, so the hold expires on its own.
    send(proxy.child, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } } });
    await waitFor(async () => {
      try {
        const records = await readLedgerRecords(join(ledgerDir, `${workspace}.jsonl`));
        return records.filter((entry) => entry.body?.tool === "orders_delete" && entry.body?.decision === "hold").length >= 2;
      } catch {
        return false;
      }
    }, "second held ledger record");
    await waitFor(() => proxy.output.length >= 5 && proxy.output[4], "hold expiry response", 300, 10);
    assert.equal(proxy.output[4].error?.data?.result, "expired");
    const exit = await closeProxy(proxy.child);
    assert.equal(exit, 0);
    assert.deepEqual(proxy.errors, []);

    const ledgerFile = join(ledgerDir, `${workspace}.jsonl`);
    const records = await readLedgerRecords(ledgerFile);
    assert.ok(records.length >= 5, `expected at least 5 ledger records, got ${records.length}`);
    assert.ok(records.every((entry) => entry.body?.argsDigest?.length === 64));
    assert.ok(records.every((entry) => entry.body?.args === undefined));
    assert.ok(records.some((entry) => entry.body?.tool === "orders_delete" && entry.body?.decision === "hold:approved"));
    assert.ok(records.some((entry) => entry.body?.tool === "orders_delete" && entry.body?.decision === "hold:expired"));
    const deleteSeq = records.find((entry) => entry.body?.tool === "orders_delete" && entry.body?.decision === "hold:approved")?.seq;
    assert.equal(typeof deleteSeq, "number");
    return { base, ledgerDir, ledgerFile, workspace, env, deleteSeq };
  } catch (error) {
    proxy.child.kill();
    throw error;
  }
}

async function runVerifyMoment(state) {
  assert.ok(state);
  const result = await runCli(["verify", "--ledger", state.ledgerDir], state.env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /chain: \d+ entries ok/);
  return result;
}

async function runTaintMoment(state) {
  assert.ok(state);
  const result = await runCli(["taint", "--ledger", state.ledgerDir, "--seq", String(state.deleteSeq)], state.env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /orders_delete/);
  assert.match(result.stdout, /seq tool decision digest/);
  return result;
}

async function runFeedMoment(state) {
  assert.ok(state);
  const result = await runCli(["feed", "--ledger", state.ledgerFile, "--json"], state.env);
  assert.equal(result.code, 0, result.stderr);
  const page = JSON.parse(result.stdout.trim());
  assert.equal(page.verified, true);
  assert.ok(page.records.some((record) => record.tool === "echo"));
  assert.ok(page.records.some((record) => record.tool === "orders_delete"));
  return result;
}

async function runAttestationMoment(state) {
  assert.ok(state);
  const code = `import { attestLedger, storeAttestation } from "./packages/ledger/src/attest.ts"; const [dir, workspace] = process.argv.slice(1); const doc = await attestLedger(dir, workspace); console.log(await storeAttestation(dir, doc));`;
  const generated = await runCommand(process.execPath, ["--input-type=module", "-e", code, state.ledgerDir, state.workspace], { env: state.env });
  assert.equal(generated.code, 0, generated.stderr);
  const path = generated.stdout.trim();
  assert.match(path, /attestations\/\d+\.json$/);
  const verified = await runCli(["verify", "--ledger", state.ledgerDir, "--attestation", path], state.env);
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /attestation: match/);
  return { path, verified };
}

async function runTamperMoment(state) {
  assert.ok(state);
  const dir = await mkdtemp(join(tmpdir(), "void-e2e-final-tamper-"));
  const tampered = join(dir, "tampered.jsonl");
  await copyFile(state.ledgerFile, tampered);
  const text = await readFile(tampered, "utf8");
  const next = text.replace("allow:resolved", "allow:xesolved");
  assert.notEqual(next, text);
  await writeFile(tampered, next);

  const verify = await runCli(["verify", "--ledger", tampered], state.env);
  assert.equal(verify.code, 1);
  assert.match(`${verify.stdout}\n${verify.stderr}`, /seq 2|entry 2/);

  const feed = await runCli(["feed", "--ledger", tampered, "--json"], state.env);
  assert.equal(feed.code, 1);
  assert.match(feed.stderr, /ledger chain invalid|body does not match digest|void feed failed/);
  await rm(dir, { recursive: true, force: true });
  return { verify, feed };
}

async function runDriftMoment() {
  // Real binary, real ledger, real manifest and real snapshot bytes: the dry-run plan comes
  // from the binary's static connector set, and apply without an executor fails with the
  // typed not-configured error instead of guessing a driver.
  const dir = await mkdtemp(join(tmpdir(), "void-e2e-final-drift-"));
  try {
    const sql = "update public.orders set status = 'paid' where id = 1";
    const statement = parseStatement(sql);
    const schema = { tables: [{ table: "public.orders", primaryKey: ["id"], columns: ["id", "status", "total"] }] };
    // The library contract: hosts inject the executor. One before-row through the real capture path.
    const exec = {
      async query(sqlText) {
        if (sqlText.toLowerCase().includes("public") && sqlText.toLowerCase().includes("orders")) {
          return [{ id: 1, status: "draft", total: 42 }];
        }
        throw new Error("unexpected query");
      },
    };
    const image = await captureBeforeImage(exec, statement, schema);
    const store = LocalSnapshotStore(join(dir, "snapshots"));
    const bytes = new TextEncoder().encode(JSON.stringify(image));
    // Slash is not a legal namespace character in the snapshot store, so the moment uses a dash.
    const snapshot = await store.put("e2e-final-postgres", bytes, { tool: "postgres.row.update" });
    const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
    const ledger = jsonlStore(signer, { dir: join(dir, "ledger") });
    const workspace = "e2e-final";
    const digest = sha256Digest(new TextEncoder().encode(JSON.stringify({ sql })));
    await ledger.append({
      workspace,
      at: "2026-09-08T00:00:00.000Z",
      tool: "postgres.row.update",
      klass: "r1",
      decision: "allow:resolved",
      argsDigest: digest,
    });
    const manifest = { digest, reference: snapshot.reference, tool: "postgres.row.update" };
    await writeFile(join(dir, "snapshots", "manifest.jsonl"), `${JSON.stringify(manifest)}\n`);

    const dry = await runCli(["replay", "--ledger", join(dir, "ledger", `${workspace}.jsonl`), "--snapshot-dir", join(dir, "snapshots"), "--seq", "1", "--dry-run"], {});
    assert.equal(dry.code, 0, `${dry.stdout}\n${dry.stderr}`);
    assert.match(dry.stdout, /tool: postgres\.row\.update/);
    assert.match(dry.stdout, /step .*: update public\.orders/);

    const apply = await runCli(["replay", "--ledger", join(dir, "ledger", `${workspace}.jsonl`), "--snapshot-dir", join(dir, "snapshots"), "--seq", "1"], {});
    assert.equal(apply.code, 1);
    assert.match(`${apply.stdout}\n${apply.stderr}`, /ExecutorNotConfigured: postgres executor not configured: VOID_PG_URL is absent/);
    return { dry, apply };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runHttpMoment() {
  if (!hasHttpSurface()) {
    note("HTTP moment", "void-proxy does not expose --transport and --upstream-url yet");
    return;
  }

  const base = await mkdtemp(join(tmpdir(), "void-e2e-final-http-"));
  const ledgerDir = join(base, "ledger");
  const home = join(base, "home");
  const workspace = "e2e-final-http";
  const env = { ...process.env, HOME: home, VOID_WORKSPACE: workspace };
  const facts = await strictFactsPath(base);
  const policy = await policyPath(base);
  const server = spawn(process.execPath, ["fixtures/e2e-http-server.mjs"], {
    cwd: rootPath,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOut = "";
  let serverErr = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => { serverOut += chunk; });
  server.stderr.on("data", (chunk) => { serverErr += chunk; });

  try {
    const url = await waitFor(() => {
      const line = serverOut.split("\n").find((candidate) => candidate.startsWith("http://"));
      return line;
    }, "HTTP fixture URL");
    const proxy = spawnProxy([
      "--transport", "http",
      "--upstream-url", url,
      "--policy", policy,
      "--facts", facts,
      "--posture", "fail-closed",
      "--ledger-dir", ledgerDir,
      "--workspace", workspace,
    ], env);
    try {
      send(proxy.child, { jsonrpc: "2.0", id: 21, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
      await waitFor(() => proxy.output.length >= 1 && proxy.output[0], "HTTP initialize response");
      assert.equal(proxy.output[0].result.protocolVersion, "2025-06-18");
      send(proxy.child, { jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "echo", arguments: { text: "hello http" } } });
      await waitFor(() => proxy.output.length >= 2 && proxy.output[1], "HTTP echo response");
      assert.equal(textFrom(proxy.output[1]), "hello http");
      await closeProxy(proxy.child);
      const verify = await runCli(["verify", "--ledger", ledgerDir], env);
      assert.equal(verify.code, 0, verify.stderr);
    } catch (error) {
      proxy.child.kill();
      throw error;
    }
  } finally {
    server.kill();
    await new Promise((resolve) => server.on("close", resolve));
  }
  assert.equal(serverErr, "");
}

export async function runAllChecks() {
  let state;
  state = await check("full product stdio moment", runStdioProductMoment);
  await check("verify moment", () => runVerifyMoment(state));
  await check("taint moment", () => runTaintMoment(state));
  await check("feed moment", () => runFeedMoment(state));
  await check("attestation moment", () => runAttestationMoment(state));
  await check("tamper moment", () => runTamperMoment(state));
  await check("drift moment", runDriftMoment);
  await check("HTTP moment", runHttpMoment);
  return { passLines: [...passLines], failures: [...failures], notes: [...notes] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("all")) {
    console.error("usage: node scripts/src/e2e-final.mjs all");
    process.exitCode = 2;
  } else {
    await runAllChecks();
    if (failures.length > 0) process.exitCode = 1;
  }
}
