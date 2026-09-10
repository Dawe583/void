import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runReplayCommand,
  type ApplyReport,
  type InversePlan,
  type ReplayConnector,
  type SnapshotReference,
} from "./replay.ts";
import type { FeedPage } from "../../ledger/src/feed.ts";
import { jsonlStore } from "../../ledger/src/store.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import { LocalSnapshotStore } from "../../connectors/src/snapshot/local.ts";
import { parseStatement } from "../../connectors/src/postgres/parse.ts";
import type { QueryExecutor } from "../../connectors/src/postgres/capture.ts";
import type { ReplayExecutor } from "../../connectors/src/postgres/replay.ts";

const argsDigest = "sha256:" + "a".repeat(64);
const snapshotDigest = "sha256:" + "b".repeat(64) as `sha256:${string}`;

const page: FeedPage = {
  verified: true,
  signed: false,
  head: "c".repeat(64),
  records: [
    {
      seq: 7,
      at: "2026-09-01T00:00:00.000Z",
      tool: "postgres.row.update",
      klass: "r1",
      decision: "allow:resolved",
      argsDigest,
      prevDigest: "0".repeat(64),
      digest: "c".repeat(64),
    },
  ],
};

const reference: SnapshotReference = {
  namespace: "workspace-a",
  digest: snapshotDigest,
  uri: "file:///snapshots/workspace-a/update.json",
};

const plan: InversePlan = {
  connector: "postgres",
  call: {
    tool: "postgres.row.update",
    connector: "postgres",
    arguments: {},
    workspace: "workspace-a",
  },
  capture: reference,
  steps: [
    {
      id: "restore-row",
      target: "public.accounts",
      operation: "update",
      dependsOn: [],
      inputDigest: snapshotDigest,
    },
  ],
  facts: [],
};

describe("runReplayCommand", () => {
  test("finds a manifest entry by args digest and prints the dry-run plan", async () => {
    const snapshotDir = await manifestDir([
      { digest: argsDigest, reference, tool: "postgres.row.update" },
    ]);
    const out: string[] = [];
    const err: string[] = [];
    let applied = false;
    const code = await runReplayCommand(
      ["--ledger", "ledger.jsonl", "--snapshot-dir", snapshotDir, "--seq", "7", "--dry-run"],
      { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
      {
        readFeed: async () => page,
        connectors: { postgres: fakeConnector({ apply: async () => { applied = true; return { applied: [], refused: [] }; } }) },
      },
    );

    assert.equal(code, 0);
    assert.equal(applied, false);
    assert.equal(err.length, 0);
    assert.match(out.join("\n"), /tool: postgres\.row\.update/);
    assert.match(out.join("\n"), /argsDigest: sha256:/);
    assert.match(out.join("\n"), /step restore-row: update public\.accounts/);
    assert.doesNotMatch(out.join("\n"), /arguments|password|payload/);
  });

  test("applies through the connector with the manifest image reference", async () => {
    const snapshotDir = await manifestDir([
      { digest: argsDigest, reference, tool: "postgres.row.update" },
    ]);
    let inverseReference: SnapshotReference | undefined;
    let appliedPlan: InversePlan | undefined;
    const out: string[] = [];
    const code = await runReplayCommand(
      ["--ledger", "ledger.jsonl", "--snapshot-dir", snapshotDir, "--seq", "7"],
      { stdout: (line) => out.push(line), stderr: () => {} },
      {
        readFeed: async () => page,
        connectors: {
          postgres: fakeConnector({
            inverse: async (capture) => {
              inverseReference = capture;
              return { ...plan, capture };
            },
            apply: async (received) => {
              appliedPlan = received;
              return { applied: ["restore-row"], refused: [] };
            },
          }),
        },
      },
    );

    assert.equal(code, 0);
    assert.deepEqual(inverseReference, reference);
    assert.equal(appliedPlan?.capture.uri, reference.uri);
    assert.match(out.join("\n"), /applied: restore-row/);
  });

  test("a missing manifest match exits loudly", async () => {
    const snapshotDir = await manifestDir([
      { digest: "sha256:" + "d".repeat(64), reference, tool: "postgres.row.update" },
    ]);
    const err: string[] = [];
    const code = await runReplayCommand(
      ["--ledger", "ledger.jsonl", "--snapshot-dir", snapshotDir, "--seq", "7"],
      { stdout: () => {}, stderr: (line) => err.push(line) },
      { readFeed: async () => page, connectors: { postgres: fakeConnector() } },
    );

    assert.equal(code, 1);
    assert.match(err.join("\n"), /no snapshot manifest match/);
  });

  test("a missing connector exits loudly", async () => {
    const snapshotDir = await manifestDir([
      { digest: argsDigest, reference, tool: "postgres.row.update" },
    ]);
    const err: string[] = [];
    const code = await runReplayCommand(
      ["--ledger", "ledger.jsonl", "--snapshot-dir", snapshotDir, "--seq", "7"],
      { stdout: () => {}, stderr: (line) => err.push(line) },
      { readFeed: async () => page, connectors: {} },
    );

    assert.equal(code, 1);
    assert.match(err.join("\n"), /no connector for tool vendor postgres/);
  });

  test("drift refusal prints the report and exits one", async () => {
    const snapshotDir = await manifestDir([
      { digest: argsDigest, reference, tool: "postgres.row.update" },
    ]);
    const out: string[] = [];
    const report: ApplyReport = {
      applied: [],
      refused: [
        {
          stepId: "restore-row",
          reason: "drift",
          changed: [
            {
              target: "public.accounts",
              key: { id: "42" },
              field: "email",
              capturedDigest: snapshotDigest,
              currentDigest: "sha256:" + "e".repeat(64) as `sha256:${string}`,
            },
          ],
        },
      ],
    };

    const code = await runReplayCommand(
      ["--ledger", "ledger.jsonl", "--snapshot-dir", snapshotDir, "--seq", "7"],
      { stdout: (line) => out.push(line), stderr: () => {} },
      { readFeed: async () => page, connectors: { postgres: fakeConnector({ apply: async () => report }) } },
    );

    assert.equal(code, 1);
    assert.match(out.join("\n"), /refused restore-row: drift/);
    assert.match(out.join("\n"), /public\.accounts/);
    assert.match(out.join("\n"), /email/);
  });

  test("ledger chain verification failure refuses before manifest lookup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-replay-ledger-"));
    const ledgerPath = join(dir, "default.jsonl");
    await writeFile(
      ledgerPath,
      JSON.stringify({
        workspace: "default",
        seq: 1,
        body: {
          at: "2026-09-01T00:00:00.000Z",
          tool: "postgres.row.update",
          klass: "r1",
          decision: "allow:resolved",
          argsDigest,
        },
        prev_hash: "0".repeat(64),
        hash: "f".repeat(64),
        key_id: "test",
        alg: "ed25519",
        signature: "ed25519:test",
      }) + "\n",
    );
    const snapshotDir = await manifestDir([
      { digest: argsDigest, reference, tool: "postgres.row.update" },
    ]);
    const err: string[] = [];

    const code = await runReplayCommand(
      ["--ledger", ledgerPath, "--snapshot-dir", snapshotDir, "--seq", "1"],
      { stdout: () => {}, stderr: (line) => err.push(line) },
      { connectors: { postgres: fakeConnector() } },
    );

    assert.equal(code, 1);
    assert.match(err.join("\n"), /ledger chain invalid/);
  });
});

async function manifestDir(records: readonly unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "void-replay-snapshots-"));
  await writeFile(join(dir, "manifest.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return dir;
}

function fakeConnector(overrides: Partial<ReplayConnector> = {}): ReplayConnector {
  return {
    id: "postgres",
    surface: "postgres",
    inverse: async () => plan,
    apply: async () => ({ applied: ["restore-row"], refused: [] }),
    ...overrides,
  };
}


describe("persisted connector replay", () => {
  test("binary lists static connectors without needing a ledger or snapshot", async () => {
    const result = await binaryReplay(["--list-connectors"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /postgres: executor absent.*VOID_PG_URL/);
    assert.match(result.stdout, /s3: executor absent/);
  });

  test("connector listing does not confuse a URL with a working executor", async () => {
    const result = await binaryReplay(["--list-connectors"], { VOID_PG_URL: "postgres://test:private-credential@localhost/example" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /postgres: executor absent.*adapter unavailable/);
    assert.doesNotMatch(result.stdout, /private-credential/);
  });

  test("connector listing reports an injected executor without calling it", async () => {
    const query: QueryExecutor["query"] = async () => { throw new Error("must not query"); };
    const out: string[] = [];
    const code = await runReplayCommand(["--list-connectors"], {
      stdout: (line) => out.push(line), stderr: () => {}, env: {},
    }, { exec: { query } });
    assert.equal(code, 0);
    assert.match(out.join("\n"), /postgres: executor configured/);
  });

  test("connector listing rejects extra replay flags", async () => {
    const result = await binaryReplay(["--list-connectors", "--seq", "1"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--list-connectors must be used alone/);
  });

  test("binary dry-run rebuilds postgres inverse steps from local snapshot bytes", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay([...fixture.argv, "--dry-run"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /inverse plan: postgres/);
    assert.match(result.stdout, /step update-0-public.accounts: update public.accounts/);
    assert.doesNotMatch(result.stdout, /private-before-value|private-after-value/);
  });

  test("binary apply without postgres configuration fails closed", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay(fixture.argv);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ExecutorNotConfigured: postgres executor not configured/);
    assert.match(result.stderr, /VOID_PG_URL/);
    assert.doesNotMatch(result.stdout, /applied:/);
  });

  test("a URL alone cannot pretend an executor adapter exists or echo credentials", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay(fixture.argv, { VOID_PG_URL: "postgres://test:private-credential@localhost/example" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /postgres executor adapter is not available/);
    assert.doesNotMatch(result.stderr, /private-credential/);
  });

  test("malformed snapshot JSON cannot leak its contents through parser errors", async (t) => {
    const fixture = await persistedFixture("postgres.row.update", new TextEncoder().encode('private-snapshot-content'));
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay([...fixture.argv, "--dry-run"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /postgres inverse planning failed/);
    assert.doesNotMatch(result.stderr, /private-snapshot-content/);
  });

  test("snapshot corruption refuses before any executor query", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    await writeFile(fixture.snapshotPath, "{}");
    let queries = 0;
    const query: QueryExecutor["query"] = async <T>(): Promise<T[]> => { queries += 1; return []; };
    const err: string[] = [];
    const code = await runReplayCommand(fixture.argv, {
      stdout: () => {}, stderr: (line) => err.push(line), env: {},
    }, { exec: { query } });
    assert.equal(code, 1);
    assert.equal(queries, 0);
    assert.match(err.join("\n"), /snapshot digest mismatch/);
  });

  test("dry-run never calls even an injected executor", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const query: QueryExecutor["query"] = async () => { throw new Error("must not query"); };
    const code = await runReplayCommand([...fixture.argv, "--dry-run"], {
      stdout: () => {}, stderr: () => {}, env: {},
    }, { exec: { query } });
    assert.equal(code, 0);
  });

  test("S3 apply without an adapter names the configuration failure", async (t) => {
    const fixture = await persistedFixture("s3.object.delete");
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay(fixture.argv);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ExecutorNotConfigured: s3 executor not configured/);
  });

  test("unknown vendors still fail rather than guessing a connector", async (t) => {
    const fixture = await persistedFixture("unknown.row.update");
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const result = await binaryReplay([...fixture.argv, "--dry-run"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no connector for tool vendor unknown/);
  });

  test("the library executor seam applies a persisted inverse without a fake environment mode", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const statements: string[] = [];
    const events: string[] = [];
    const query: QueryExecutor["query"] = async <T>(sql: string, params?: readonly unknown[]): Promise<T[]> => {
      statements.push(sql);
      if (sql.startsWith("select")) return [{ id: 42, status: "private-after-value" }] as T[];
      assert.deepEqual(params, ["private-before-value", "42"]);
      return [];
    };
    const exec: ReplayExecutor = {
      query,
      begin: async () => { events.push("begin"); },
      commit: async () => { events.push("commit"); },
      rollback: async () => { events.push("rollback"); },
    };
    const out: string[] = [];
    const err: string[] = [];
    const code = await runReplayCommand(fixture.argv, {
      stdout: (line) => out.push(line), stderr: (line) => err.push(line), env: {},
    }, { exec });
    assert.equal(code, 0, err.join("\n"));
    assert.deepEqual(events, ["begin", "commit"]);
    assert.equal(statements.length, 2);
    assert.match(statements[1]!, /^update "public"."accounts"/);
    assert.match(out.join("\n"), /applied: update-0-public.accounts/);
  });

  test("native executor errors never expose service payloads", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    for (const phase of ["query", "begin"] as const) {
      const fail = async (): Promise<never> => { throw new Error("private-driver-credential"); };
      const exec: ReplayExecutor = { query: fail, ...(phase === "begin" ? { begin: fail } : {}) };
      const out: string[] = [];
      const err: string[] = [];
      const code = await runReplayCommand(fixture.argv, {
        stdout: (line) => out.push(line), stderr: (line) => err.push(line), env: {},
      }, { exec });
      assert.equal(code, 1);
      assert.match(out.join("\n"), /refused transaction: internal_error/);
      assert.doesNotMatch([...out, ...err].join("\n"), /private-driver-credential/);
    }
  });

  test("persisted inverse refuses human drift and reports the changed field", async (t) => {
    const fixture = await persistedFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const statements: string[] = [];
    const query: QueryExecutor["query"] = async <T>(sql: string): Promise<T[]> => {
      statements.push(sql);
      return [{ id: 42, status: "private-human-value" }] as T[];
    };
    const out: string[] = [];
    const code = await runReplayCommand(fixture.argv, {
      stdout: (line) => out.push(line), stderr: () => {}, env: {},
    }, { exec: { query } });
    assert.equal(code, 1);
    assert.equal(statements.length, 1);
    assert.match(out.join("\n"), /refused update-0-public.accounts: drift/);
    assert.match(out.join("\n"), /column status changed/);
    assert.doesNotMatch(out.join("\n"), /private-human-value|private-before-value/);
  });
});

async function persistedFixture(tool = "postgres.row.update", snapshotBytes?: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "void-replay-persisted-"));
  const snapshotDir = join(root, "snapshots");
  const statement = parseStatement("update public.accounts set status = 'private-after-value' where id = 42");
  const image = {
    statement,
    rows: [{ table: "public.accounts", key: { id: "42" }, row: { id: 42, status: "private-before-value" }, dependencies: [] }],
    cascadeTables: [],
    capturedAt: "2026-09-01T00:00:00.000Z",
  };
  const captured = await LocalSnapshotStore(snapshotDir).put("postgres", snapshotBytes ?? new TextEncoder().encode(JSON.stringify(image)));
  await writeFile(join(snapshotDir, "manifest.jsonl"), JSON.stringify({ digest: argsDigest, reference: captured.reference, tool }) + "\n");
  const signer = await devKeyProvider({ dir: join(root, "keys"), env: {} });
  const ledgerDir = join(root, "ledger");
  await jsonlStore(signer, { dir: ledgerDir }).append({
    workspace: "test", at: image.capturedAt, tool, klass: "r1", decision: "allow:resolved", argsDigest,
  });
  return {
    root,
    snapshotPath: fileURLToPath(captured.reference.uri),
    argv: ["--ledger", join(ledgerDir, "test.jsonl"), "--snapshot-dir", snapshotDir, "--seq", "1"],
  };
}

async function binaryReplay(argv: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const binary = fileURLToPath(new URL("../bin/void.mjs", import.meta.url));
  try {
    const result = await promisify(execFile)(process.execPath, [binary, "replay", ...argv], { env, timeout: 10000 });
    return { ...result, code: 0 };
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
