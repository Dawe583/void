#!/usr/bin/env node
/**
 * Smoke-grade measurements on this machine only, not external baselines or
 * production capacity claims. No warmup, network, subprocess transport or real
 * tool work: forward uses an in-process echo and the real signed, fsynced ledger.
 * Scale is the forward/append count (100 by default); classify uses scale * 100
 * lookups across the current registry, with seeded synthetic facts. Use scale
 * 1000 for 1000 forward calls and appends. Per-call clocks add measurement cost.
 * Ledger serialization is a separate canonical JSON plus JSON.stringify probe,
 * not an isolated component of append latency or an estimate of fsync cost.
 * runProxy cannot take a signer, so the CLI forks an isolated benchmark process
 * with a fresh inline key in its explicit env. No process.env writes or user key
 * files are needed. Fork startup is outside the measured intervals.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { runProxy } from "../../packages/proxy/src/bin.ts";
import { canonicalJson, jsonlStore } from "../../packages/ledger/src/store.ts";
import { keyProviderFromPkcs8 } from "../../packages/ledger/src/sign.ts";
import { classifyTool, registry } from "../../packages/registry/src/index.ts";

function summarize(name, latencies, elapsed) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  assert.ok(sorted.length > 0 && elapsed > 0n);
  return {
    name,
    count: sorted.length,
    ops: sorted.length * 1e9 / Number(elapsed),
    p50: percentile(0.50),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

async function forward(count, dir, signer, now) {
  const policyPath = join(dir, "allow.yaml");
  await writeFile(policyPath, "version: 1\nrules:\n  - match: {}\n    decision: allow\n");
  const ledgerDir = join(dir, "forward");
  const lines = Array.from({ length: count }, (_, id) => JSON.stringify({
    jsonrpc: "2.0", id, method: "tools/call",
    params: { name: "aws.s3.bucket.delete", arguments: { sequence: id } },
  }));
  const starts = new Map();
  const latencies = [];
  const responses = [];
  const errors = [];
  let begin;
  let end;
  async function* input() {
    for (let id = 0; id < count; id += 1) {
      const start = now();
      begin ??= start;
      starts.set(id, start);
      yield lines[id];
    }
  }
  await runProxy({
    upstreamCommand: ["bench-echo"], policyPath, ledgerDir,
    workspace: "bench", posture: "fail-closed", shutdownSignals: false,
    input: input(),
    output(line) {
      const completed = now();
      const response = JSON.parse(line);
      responses.push(response);
      const start = starts.get(response.id);
      if (start !== undefined) latencies.push(Number(completed - start) / 1e6);
      end = completed;
    },
    error(line) { errors.push(line); },
    upstreamSpawn(events) {
      return {
        send(line) {
          const request = JSON.parse(line);
          events.onMessage(JSON.stringify({
            jsonrpc: "2.0", id: request.id, result: request.params.arguments,
          }));
        },
        close() {},
        onStderr() { return () => {}; },
      };
    },
  });
  assert.deepEqual(errors, []);
  assert.equal(responses.length, count);
  for (let id = 0; id < count; id += 1) {
    assert.deepEqual(responses[id], { jsonrpc: "2.0", id, result: { sequence: id } });
  }
  const verification = await jsonlStore(signer, { dir: ledgerDir }).verify("bench");
  assert.equal(verification.ok, true, verification.reason);
  assert.equal(verification.checked, count * 2);
  return {
    ...summarize("forward", latencies, end - begin),
    responses: responses.length, ledgerEntries: verification.checked,
  };
}

async function append(count, store, now) {
  const bodies = Array.from({ length: count }, (_, sequence) => ({
    workspace: "bench", sequence, tool: "aws.s3.bucket.delete",
    klass: "r3", decision: "allow", argsDigest: "a".repeat(64),
  }));
  const latencies = [];
  const receipts = [];
  const begin = now();
  for (const body of bodies) {
    const start = now();
    const receipt = await store.append(body);
    latencies.push(Number(now() - start) / 1e6);
    receipts.push(receipt);
  }
  const elapsed = now() - begin;
  const serializationTimes = [];
  let bytes = 0;
  const serializationStart = now();
  for (const receipt of receipts) {
    const start = now();
    const canonical = canonicalJson(receipt.body);
    const line = JSON.stringify(receipt);
    serializationTimes.push(Number(now() - start) / 1e6);
    bytes += Buffer.byteLength(canonical) + Buffer.byteLength(line);
  }
  const serializationElapsed = now() - serializationStart;
  const verification = await store.verify("bench");
  assert.equal(verification.ok, true, verification.reason);
  assert.equal(verification.checked, count);
  return {
    ...summarize("ledger-append", latencies, elapsed),
    ledgerEntries: verification.checked,
    serialization: {
      ...summarize("serialization-probe", serializationTimes, serializationElapsed),
      bytes,
      note: "Separate canonicalJson(body) plus JSON.stringify(receipt), not an append latency breakdown",
    },
  };
}

function declaredFacts(condition, facts) {
  if (condition?.kind === "fact") facts[condition.fact] = condition.is ?? true;
  else if (condition?.kind === "not") declaredFacts(condition.of, facts);
  else if (condition?.kind === "all" || condition?.kind === "any") {
    for (const child of condition.of) declaredFacts(child, facts);
  }
}

function classify(count, entries, random, now) {
  const contexts = entries.map((entry) => {
    const facts = {};
    for (const item of entry.cases) declaredFacts(item.if, facts);
    return [
      { facts, args: { versionId: "bench", id: "bench" } },
      { facts: Object.fromEntries(Object.keys(facts).map((key) => [key, false])), args: {} },
      { facts: {}, args: {} },
    ];
  });
  // Input generation stays outside the timer so this measures the evaluator,
  // not random number generation. A fixed seed makes the workload repeatable.
  const calls = Array.from({ length: count }, () => {
    const index = Math.floor(random() * entries.length);
    return [entries[index].id, contexts[index][Math.floor(random() * 3)]];
  });
  const latencies = [];
  const outcomes = {};
  const begin = now();
  for (const [id, context] of calls) {
    const start = now();
    const result = classifyTool(id, context);
    latencies.push(Number(now() - start) / 1e6);
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  const elapsed = now() - begin;
  assert.equal(outcomes["unknown-tool"] ?? 0, 0);
  return { ...summarize("classify", latencies, elapsed), outcomes };
}

async function main(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { scale: { type: "string", default: "100" }, json: { type: "boolean" } } }));
    if (!/^\d+$/.test(values.scale) || !Number.isSafeInteger(Number(values.scale) * 100) || Number(values.scale) < 1) {
      throw new Error("scale must be a positive safe integer");
    }
  } catch {
    throw new Error("Usage: node scripts/src/bench.mjs [--scale N] [--json]; N must be a positive safe integer");
  }
  const scale = Number(values.scale);
  const dir = await mkdtemp(join(tmpdir(), "void-bench-"));
  try {
    const signer = keyProviderFromPkcs8(Buffer.from(process.env.VOID_SIGNING_KEY ?? "", "base64"));
    const now = () => process.hrtime.bigint();
    let seed = 42;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const scenarios = [
      await forward(scale, dir, signer, now),
      await append(scale, jsonlStore(signer, { dir: join(dir, "append") }), now),
      classify(scale * 100, registry, random, now),
    ];
    const report = {
      smokeGrade: true, scope: "this machine only; no external baseline comparisons",
      node: process.version, platform: process.platform, arch: process.arch,
      scale, registryEntries: registry.length, latencyUnit: "ms", throughputUnit: "ops/sec",
      scenarios,
    };
    if (values.json) console.log(JSON.stringify(report));
    else {
      console.log("Smoke-grade, this machine only; no external baseline comparisons. Latency in ms.");
      console.log("scenario          ops/sec        p50        p95        p99");
      for (const row of scenarios) {
        const metrics = [row.ops.toFixed(2), ...[row.p50, row.p95, row.p99].map((value) => value.toFixed(6))];
        const extra = row.serialization === undefined ? "" : `  serialization probe p50=${row.serialization.p50.toFixed(6)}ms (separate)`;
        console.log(`${row.name.padEnd(16)} ${metrics.map((value) => value.padStart(10)).join(" ")}${extra}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.send === undefined) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const child = fork(new URL(import.meta.url), process.argv.slice(2), {
    env: { ...process.env, VOID_SIGNING_KEY: key },
    execArgv: [],
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} else {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
