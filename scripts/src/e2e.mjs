#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick, setTimeout as delay } from "node:timers/promises";

import { runProxy } from "../../packages/proxy/src/bin.ts";

const passLines = [];
const failures = [];

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

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

class ScriptInput {
  constructor() {
    this.lines = [];
    this.waiters = [];
    this.done = false;
  }

  push(message) {
    this.pushLine(JSON.stringify(message));
  }

  pushLine(line) {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: line, done: false });
      return;
    }
    this.lines.push(line);
  }

  end() {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve({ value: line, done: false });
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return() {
    this.end();
    return Promise.resolve({ value: undefined, done: true });
  }
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = predicate();
    if (value) return value;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function strictFactsPath() {
  const raw = JSON.parse(await readFile("fixtures/facts.json", "utf8"));
  const facts = {};
  for (const [name, value] of Object.entries(raw)) {
    facts[name] = { value, verifiedAt: "2026-09-08T00:00:00Z", source: "fixture" };
  }
  const dir = await mkdtemp(join(tmpdir(), "void-e2e-"));
  const path = join(dir, "facts.json");
  await writeFile(path, `${JSON.stringify({ facts })}\n`);
  return path;
}

function textFrom(response) {
  return response?.result?.content?.[0]?.text;
}

async function runApiPass(factsPath) {
  const input = new ScriptInput();
  const output = [];
  const errors = [];
  let holdQueue = null;
  const ledgerDir = await mkdtemp(join(tmpdir(), "void-e2e-ledger-"));
  const running = runProxy({
    upstreamCommand: ["node", "fixtures/e2e-server.mjs"],
    policyPath: "fixtures/e2e-policy.yaml",
    factsPath,
    posture: "fail-closed",
    ledgerDir,
    workspace: "e2e",
    input,
    output(line) { output.push(JSON.parse(line)); },
    error(line) { errors.push(line); process.stderr.write(`${line}\n`); },
    onHold(queue) { holdQueue = queue; },
  });

  await check("api initialize version", async () => {
    input.push({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    await waitFor(() => output.length >= 1, "initialize response");
    assert.equal(output[0].result.protocolVersion, "2025-06-18");
  });

  await check("api tools/list fixture tools", async () => {
    input.push({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await waitFor(() => output.length >= 2, "tools/list response");
    assert.deepEqual(output[1].result.tools.map((tool) => tool.name), ["echo", "orders_delete"]);
  });

  await check("api echo forwards result", async () => {
    input.push({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hello void" } } });
    await waitFor(() => output.length >= 3, "echo response");
    assert.equal(textFrom(output[2]), "hello void");
  });

  let heldId = "";
  await check("api orders_delete parks without response", async () => {
    input.push({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } } });
    const held = await waitFor(() => holdQueue?.list()?.[0], "held call");
    heldId = held.id;
    process.stderr.write(`held ${heldId}\n`);
    await tick();
    await tick();
    assert.equal(output.length, 3);
  });

  await check("api hold approval releases upstream result", async () => {
    assert.equal(holdQueue.resolve(heldId, { kind: "approved" }), true);
    await waitFor(() => output.length >= 4, "approved call response");
    assert.equal(textFrom(output[3]), "deleted 2");
    assert.equal(output[3].result.count, 2);
  });

  await check("api no unexpected stderr", async () => {
    assert.deepEqual(errors, []);
  });

  await check("api ledger recorded every decided call", async () => {
    const ledgerFile = join(ledgerDir, "e2e.jsonl");
    const raw = await readFile(ledgerFile, "utf8");
    const entries = raw.trim().split("\n").map((line) => JSON.parse(line));
    // echo forwards (decision allow, resolution allow:resolved), orders_delete
    // holds and resolves: at least 4 records, none with a payload body.
    assert.ok(entries.length >= 4, `expected at least 4 ledger entries, got ${entries.length}`);
    assert.ok(entries.every((entry) => entry.body?.argsDigest?.length === 64));
    assert.ok(entries.every((entry) => entry.body?.args === undefined));
    assert.ok(entries.every((entry) => typeof entry.prev_hash === "string"));
  });

  input.end();
  await running;
}

async function runBinaryObservePass(factsPath) {
  const child = spawn(process.execPath, [
    "packages/proxy/bin/void-proxy.mjs",
    "--upstream", process.execPath,
    "--args", "fixtures/e2e-server.mjs",
    "--policy", "fixtures/e2e-policy.yaml",
    "--facts", factsPath,
    "--posture", "observe",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  const output = [];
  const errors = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.split("\n")) if (line.trim() !== "") output.push(JSON.parse(line));
  });
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split("\n")) if (line.trim() !== "") errors.push(line);
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  await check("binary observe initialize", async () => {
    send({ jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    await waitFor(() => output.length >= 1, "binary initialize response");
    assert.equal(output[0].result.protocolVersion, "2025-06-18");
  });

  await check("binary observe echo", async () => {
    send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "echo", arguments: { text: "observe echo" } } });
    await waitFor(() => output.length >= 2, "binary echo response");
    assert.equal(textFrom(output[1]), "observe echo");
  });

  await check("binary observe orders_delete forwards", async () => {
    send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } } });
    await waitFor(() => output.length >= 3, "binary observe delete response");
    assert.equal(textFrom(output[2]), "deleted 2");
    assert.match(errors.join("\n"), /observe: hold verdict for orders_delete forwarded/);
  });

  child.stdin.end();
  const exit = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
  await check("binary observe exits zero", async () => {
    assert.equal(exit, 0);
  });
}

async function runGapChecks() {
  const binSource = await readFile("packages/proxy/src/bin.ts", "utf8");
  await check("bin exposes the hold queue through the onHold hook", async () => {
    assert.match(binSource, /readonly onHold\?:/);
  });
  await check("bin wires a real ledger store into every decided call", async () => {
    assert.match(binSource, /ledgerStore/);
    assert.match(binSource, /ledgerDir/);
    assert.doesNotMatch(binSource, /ledger: \(\) => \{\}/);
  });
  await check("fail-closed startup refuses to run without a ledger directory", async () => {
    assert.match(binSource, /fail-closed posture requires a ledger directory/);
  });
}

const factsPath = await strictFactsPath();
await runApiPass(factsPath);
await runBinaryObservePass(factsPath);
await runGapChecks();

if (failures.length > 0) process.exitCode = 1;
