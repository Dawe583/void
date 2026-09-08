import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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

const argsDigest = "sha256:" + "a".repeat(64);
const snapshotDigest = "sha256:" + "b".repeat(64) as `sha256:${string}`;

const page: FeedPage = {
  verified: true,
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
