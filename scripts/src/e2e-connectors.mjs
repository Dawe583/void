#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runReplayCommand } from "../../packages/cli/src/replay.ts";
import { jsonlStore } from "../../packages/ledger/src/store.ts";
import { devKeyProvider } from "../../packages/ledger/src/sign.ts";
import { captureBeforeImage } from "../../packages/connectors/src/postgres/capture.ts";
import { connectorFacts } from "../../packages/connectors/src/postgres/classify.ts";
import { buildInverse } from "../../packages/connectors/src/postgres/inverse.ts";
import { applyInverse } from "../../packages/connectors/src/postgres/replay.ts";
import { parseStatement } from "../../packages/connectors/src/postgres/parse.ts";
import { captureObject } from "../../packages/connectors/src/s3/capture.ts";
import { applyRestore } from "../../packages/connectors/src/s3/apply.ts";
import { restoreObject } from "../../packages/connectors/src/s3/inverse.ts";
import { LocalSnapshotStore } from "../../packages/connectors/src/snapshot/local.ts";
import { S3SnapshotStore } from "../../packages/connectors/src/snapshot/s3.ts";
import { sha256Digest } from "../../packages/connectors/src/snapshot/store.ts";
import { manifestWriter } from "../../packages/connectors/src/manifest.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

export async function runAllChecks() {
  await check("postgres update capture and replay restores rows", async () => {
    await runPostgresRoundTrip();
  });
  await check("postgres update replay refuses drift", async () => {
    await runPostgresDrift();
  });
  await check("void replay dry-run reads ledger and manifest", async () => {
    await runReplayDryRun();
  });
  await check("s3 capture and restore round trip", async () => {
    await runS3RoundTrip();
  });
  await check("s3 restore refuses drift", async () => {
    await runS3Drift();
  });
  return { passLines: [...passLines], failures: [...failures] };
}

export async function runPostgresRoundTrip() {
  const original = [{ id: 1, status: "draft", total: 42 }];
  const exec = new FakeQueryExecutor({ "public.orders": cloneRows(original) });
  const statement = parseStatement("update public.orders set status = 'paid' where id = 1");
  const image = await captureBeforeImage(exec, statement, postgresSchema());
  const facts = connectorFacts(statement, image);
  const snapshotRoot = await mkdtemp(join(tmpdir(), "void-e2e-pg-snapshot-"));
  try {
    const store = LocalSnapshotStore(snapshotRoot);
    const snapshot = await putSnapshot(store, "e2e-pg", image);
    const snapshotDir = await mkdtemp(join(tmpdir(), "void-e2e-pg-manifest-"));
    await writeManifest(snapshotDir, { digest: argsDigest({ sql: statement.sql }), reference: snapshot.reference, tool: "postgres.row.update" });
    await exec.applyUpdate("public.orders", { id: "1" }, { status: "paid" });
    const steps = buildInverse(statement, image);
    const report = await applyInverse(exec, steps, image);

    assert.deepEqual(facts, { "pg.capture.before_image": "true", "pg.cascade.traversed": "false" });
    assert.deepEqual(report.refused, []);
    assert.deepEqual(exec.table("public.orders"), original);
    assert.match(await readFile(join(snapshotDir, "manifest.jsonl"), "utf8"), /postgres\.row\.update/);
    return { image, report, reference: snapshot.reference };
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}

export async function runPostgresDrift() {
  const exec = new FakeQueryExecutor({ "public.orders": [{ id: 1, status: "draft", total: 42 }] });
  const statement = parseStatement("update public.orders set status = 'paid' where id = 1");
  const image = await captureBeforeImage(exec, statement, postgresSchema());
  await exec.applyUpdate("public.orders", { id: "1" }, { status: "human" });
  const report = await applyInverse(exec, buildInverse(statement, image), image);

  assert.deepEqual(report.applied, []);
  assert.equal(report.refused[0]?.reason, "drift");
  assert.match(report.refused[0]?.report ?? "", /status changed/);
  assert.deepEqual(exec.table("public.orders"), [{ id: 1, status: "human", total: 42 }]);
  return report;
}

export async function runReplayDryRun() {
  const root = await mkdtemp(join(tmpdir(), "void-e2e-replay-"));
  const ledgerDir = join(root, "ledger");
  const keysDir = join(root, "keys");
  const snapshotDir = join(root, "snapshots");
  const workspace = "e2e-connectors";
  const digest = argsDigest({ sql: "update public.orders set status = 'paid' where id = 1" });
  const reference = {
    namespace: "e2e-pg",
    digest: "sha256:" + "b".repeat(64),
    uri: "file:///tmp/void-e2e-postgres-before-image.json",
  };
  const plan = {
    connector: "postgres",
    call: { tool: "postgres.row.update", connector: "postgres", arguments: {}, workspace },
    capture: reference,
    steps: [{ id: "restore-orders-1", target: "public.orders", operation: "update", dependsOn: [], inputDigest: reference.digest }],
    facts: [],
  };

  try {
    const signer = await devKeyProvider({ dir: keysDir, env: {} });
    const store = jsonlStore(signer, { dir: ledgerDir });
    await store.append({
      workspace,
      at: "2026-09-08T00:00:00.000Z",
      tool: "postgres.row.update",
      klass: "r1",
      decision: "allow:resolved",
      argsDigest: digest,
    });
    await writeManifest(snapshotDir, { digest, reference, tool: "postgres.row.update" });

    const out = [];
    const err = [];
    const code = await runReplayCommand(
      ["--ledger", join(ledgerDir, `${workspace}.jsonl`), "--snapshot-dir", snapshotDir, "--seq", "1", "--dry-run"],
      { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
      { connectors: { postgres: { id: "postgres", surface: "postgres", inverse: async () => plan, apply: async () => ({ applied: [], refused: [] }) } } },
    );

    const text = out.join("\n");
    assert.equal(code, 0, err.join("\n"));
    assert.equal(err.length, 0);
    assert.match(text, /tool: postgres\.row\.update/);
    assert.match(text, new RegExp(escapeRegExp(digest)));
    assert.match(text, /snapshot: file:\/\/\/tmp\/void-e2e-postgres-before-image\.json/);
    assert.match(text, /step restore-orders-1: update public\.orders/);
    return { out, ledger: join(ledgerDir, `${workspace}.jsonl`) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function runS3RoundTrip() {
  const client = new FakeS3Client();
  const store = S3SnapshotStore(client, { bucket: "snapshots", prefix: "void" });
  const call = { bucket: "app", key: "orders.csv" };
  await client.putObject({ bucket: call.bucket, key: call.key, body: encoder.encode("before") });
  const captured = await captureObject(store, client, call, () => new Date("2026-09-08T00:00:00Z"));
  await client.deleteObject(call);
  const bytes = await store.get(captured.reference);
  const restoredDirect = await restoreObject(client, call, { bytes, etag: captured.etag });
  const afterDirect = await client.getObject(call);
  assert.equal(decoder.decode(afterDirect.body), "before");
  assert.ok(restoredDirect.etag !== undefined);

  await client.deleteObject(call);
  const report = await applyRestore(store, client, { stepId: "restore-s3", call, reference: captured.reference, capturedEtag: captured.etag });
  assert.deepEqual(report, { applied: ["restore-s3"], refused: [] });
  assert.equal(decoder.decode((await client.getObject(call)).body), "before");
  return { captured, report };
}

export async function runS3Drift() {
  const client = new FakeS3Client();
  const store = S3SnapshotStore(client, { bucket: "snapshots", prefix: "void" });
  const call = { bucket: "app", key: "orders.csv" };
  await client.putObject({ bucket: call.bucket, key: call.key, body: encoder.encode("before") });
  const captured = await captureObject(store, client, call, () => new Date("2026-09-08T00:00:00Z"));
  await client.putObject({ bucket: call.bucket, key: call.key, body: encoder.encode("human change") });
  const report = await applyRestore(store, client, { stepId: "restore-s3", call, reference: captured.reference, capturedEtag: captured.etag });

  assert.deepEqual(report.applied, []);
  assert.equal(report.refused[0]?.reason, "drift");
  assert.equal(decoder.decode((await client.getObject(call)).body), "human change");
  return report;
}

class FakeQueryExecutor {
  constructor(tables) {
    this.tables = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, cloneRows(rows)]));
    this.began = false;
    this.committed = false;
    this.rolledBack = false;
  }

  async begin() {
    this.began = true;
  }

  async commit() {
    this.committed = true;
  }

  async rollback() {
    this.rolledBack = true;
  }

  table(name) {
    return cloneRows(this.tables[name] ?? []);
  }

  async applyUpdate(table, key, patch) {
    const row = this.findRow(table, key);
    assert.ok(row, `missing row ${table} ${JSON.stringify(key)}`);
    Object.assign(row, patch);
  }

  async query(sql, params = []) {
    const lower = sql.toLowerCase();
    if (lower.includes("information_schema.table_constraints")) return [];
    if (lower.startsWith("select")) return this.select(sql, params);
    if (lower.startsWith("update")) return this.update(sql, params);
    if (lower.startsWith("insert")) return this.insert(sql, params);
    return [];
  }

  select(sql, params) {
    const table = tableFromSql(sql);
    const rows = this.tables[table] ?? [];
    if (params.length > 0) {
      const columns = whereColumns(sql);
      return cloneRows(rows.filter((row) => columns.every((column, index) => String(row[column]) === String(params[index]))));
    }
    const literal = literalWhere(sql);
    if (literal === null) return cloneRows(rows);
    return cloneRows(rows.filter((row) => String(row[literal.column]) === literal.value));
  }

  update(sql, params) {
    const table = tableFromSql(sql);
    const rows = this.tables[table] ?? [];
    const assignments = assignmentColumns(sql);
    const columns = whereColumns(sql);
    const keyParams = params.slice(assignments.length);
    for (const row of rows) {
      if (columns.every((column, index) => String(row[column]) === String(keyParams[index]))) {
        assignments.forEach((column, index) => { row[column] = params[index]; });
      }
    }
    return [];
  }

  insert(sql, params) {
    const table = tableFromSql(sql);
    const columns = insertColumns(sql);
    const row = {};
    columns.forEach((column, index) => { row[column] = params[index]; });
    (this.tables[table] ??= []).push(row);
    return [];
  }

  findRow(table, key) {
    return (this.tables[table] ?? []).find((row) => Object.entries(key).every(([name, value]) => String(row[name]) === String(value)));
  }
}

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.snapshots = new Map();
    this.nextVersion = 1;
  }

  async getBucketVersioning() {
    return { status: "Disabled", mfaDelete: "Disabled" };
  }

  async getObject(input) {
    if ("bucket" in input) {
      const stored = this.objects.get(`${input.bucket}/${input.key}`);
      if (stored === undefined) throw notFound();
      return { body: new Uint8Array(stored.body), etag: stored.etag, versionId: stored.versionId };
    }
    const bytes = this.snapshots.get(input.key);
    if (bytes === undefined) throw notFound();
    return new Uint8Array(bytes);
  }

  async putObject(input) {
    if ("bytes" in input) {
      this.snapshots.set(input.key, new Uint8Array(input.bytes));
      return;
    }
    const body = new Uint8Array(input.body);
    const etag = quotedHex(body);
    const versionId = `v${this.nextVersion++}`;
    this.objects.set(`${input.bucket}/${input.key}`, { body, etag, versionId });
    return { etag, versionId };
  }

  async deleteObject(input) {
    this.objects.delete(`${input.bucket}/${input.key}`);
    return { versionId: `v${this.nextVersion++}`, deleteMarker: true };
  }
}

async function putSnapshot(store, namespace, value) {
  return store.put(namespace, encoder.encode(JSON.stringify(value)), { tool: value.statement.sql });
}

async function writeManifest(snapshotDir, record) {
  await manifestWriter(snapshotDir).write(record);
}

function postgresSchema() {
  return { tables: [{ table: "public.orders", primaryKey: ["id"], columns: ["id", "status", "total"] }] };
}

function argsDigest(value) {
  return sha256Digest(encoder.encode(JSON.stringify(value)));
}

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function tableFromSql(sql) {
  const quoted = /"([^".]+)"\."([^"]+)"/.exec(sql);
  if (quoted !== null) return `${quoted[1]}.${quoted[2]}`;
  const plain = /(?:from|update|into)\s+([a-zA-Z0-9_.]+)/i.exec(sql);
  if (plain?.[1] !== undefined) return plain[1];
  throw new Error(`missing table in ${sql}`);
}

function whereColumns(sql) {
  const where = sql.split(/\swhere\s/i)[1] ?? "";
  return [...where.matchAll(/"?([a-zA-Z0-9_]+)"?\s*=\s*\$\d+/g)].map((match) => match[1]).filter((value) => value !== undefined);
}

function assignmentColumns(sql) {
  const between = /\sset\s(.+)\swhere\s/i.exec(sql)?.[1] ?? "";
  return [...between.matchAll(/"?([a-zA-Z0-9_]+)"?\s*=\s*\$\d+/g)].map((match) => match[1]).filter((value) => value !== undefined);
}

function insertColumns(sql) {
  const raw = /\(([^)]+)\)\s+overriding system value values/i.exec(sql)?.[1] ?? "";
  return [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((value) => value !== undefined);
}

function literalWhere(sql) {
  const match = /\swhere\s+"?([a-zA-Z0-9_]+)"?\s*=\s*'?([^']+?)'?\s*$/i.exec(sql);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { column: match[1], value: match[2] };
}

function quotedHex(bytes) {
  return `"${Buffer.from(bytes).toString("hex")}"`;
}

function notFound() {
  const error = new Error("missing key");
  error.code = "NoSuchKey";
  error.statusCode = 404;
  return error;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (import.meta.url === invokedPath) {
  const result = await runAllChecks();
  if (result.failures.length > 0) process.exitCode = 1;
}
