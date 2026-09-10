import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { devKeyProvider, sha256Hex } from "../../ledger/src/sign.ts";
import { jsonlStore } from "../../ledger/src/store.ts";
import { entryHash } from "../../ledger/src/canonical.ts";
import { verifyLedgerFile } from "../../ledger/src/verify.ts";

import { VoidClient } from "./client.ts";
import { HoldDeniedError, LedgerVerifyError, RefusedError } from "./errors.ts";

async function fixturePolicy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "void-sdk-policy-"));
  const path = join(dir, "policy.yaml");
  await writeFile(path, [
    "version: 1",
    "rules:",
    "  - match:",
    "      tool: echo",
    "    decision: allow",
    "  - match:",
    "      tool: orders_delete",
    "    decision: hold",
    "    seconds: 5",
    "    notify: [cli]",
    "    rationale: destructive fixture tool requires approval",
    "  - match: {}",
    "    decision: deny",
    "    rationale: only SDK fixture tools are allowed",
    "",
  ].join("\n"));
  return path;
}

async function makeClient(workspace: string): Promise<VoidClient> {
  return new VoidClient({
    ledgerDir: await mkdtemp(join(tmpdir(), "void-sdk-ledger-")),
    workspace,
    policyPath: await fixturePolicy(),
    connect: { upstreamCommand: [process.execPath, "../../fixtures/e2e-server.mjs"] },
    requestTimeoutMs: 5_000,
  });
}

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function textFrom(result: unknown): string | undefined {
  const content = (result as { readonly content?: readonly { readonly text?: string }[] }).content;
  return content?.[0]?.text;
}

describe("VoidClient", () => {
  test("forwards a request and resolves the matching id", async () => {
    const client = await makeClient("forward");
    try {
      const result = await client.request("tools/call", { name: "echo", arguments: { text: "hello sdk" } });
      assert.equal(textFrom(result), "hello sdk");
    } finally {
      client.close();
    }
  });

  test("parks a hold and resolves awaitHold after approval", async () => {
    const client = await makeClient("approval");
    try {
      const call = client.request("tools/call", { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } });
      const held = await waitFor(() => client.pendingHolds()[0], "pending hold");
      assert.equal(client.hold(held.holdId).decide({ kind: "approved", by: "tester" }), true);
      const heldResult = await client.awaitHold(held.holdId);
      assert.equal(textFrom(heldResult), "deleted 2");
      assert.equal(await call, heldResult);
    } finally {
      client.close();
    }
  });

  test("rejects awaitHold with HoldDeniedError after denial", async () => {
    const client = await makeClient("denial");
    try {
      const call = client.request("tools/call", { name: "orders_delete", arguments: { where: "status = stale", rows: 2 } });
      const held = await waitFor(() => client.pendingHolds()[0], "pending hold");
      assert.equal(client.hold(held.holdId).decide({ kind: "denied", by: "tester", reason: "fixture denial" }), true);
      await assert.rejects(client.awaitHold(held.holdId), (error: unknown) => {
        assert.ok(error instanceof HoldDeniedError);
        assert.equal(error.code, "VOID_HOLD_DENIED");
        assert.equal(error.holdId, held.holdId);
        return true;
      });
      await assert.rejects(call, HoldDeniedError);
    } finally {
      client.close();
    }
  });


  test("maps invalid policy startup to PolicyStartupError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-sdk-invalid-policy-"));
    const policyPath = join(dir, "policy.yaml");
    await writeFile(policyPath, "version: 1\nrules: []\n");
    const client = new VoidClient({
      ledgerDir: await mkdtemp(join(tmpdir(), "void-sdk-ledger-")),
      workspace: "invalid-policy",
      policyPath,
      connect: { upstreamCommand: [process.execPath, "../../fixtures/e2e-server.mjs"] },
      requestTimeoutMs: 1_000,
    });
    try {
      await assert.rejects(client.request("tools/call", { name: "echo", arguments: { text: "never" } }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "PolicyStartupError");
        assert.equal((error as { readonly code?: string }).code, "VOID_POLICY_STARTUP");
        return true;
      });
    } finally {
      client.close();
    }
  });

  test("refuses startup when ledger verification fails", async () => {
    const ledgerDir = await mkdtemp(join(tmpdir(), "void-sdk-bad-ledger-"));
    await writeFile(join(ledgerDir, "bad.jsonl"), "not json\n");
    const client = new VoidClient({
      ledgerDir,
      workspace: "bad",
      policyPath: await fixturePolicy(),
      connect: { upstreamCommand: [process.execPath, "../../fixtures/e2e-server.mjs"] },
      requestTimeoutMs: 1_000,
    });
    try {
      await assert.rejects(client.request("tools/call", { name: "echo", arguments: { text: "never" } }), (error: unknown) => {
        assert.ok(error instanceof LedgerVerifyError);
        assert.equal(error.code, "VOID_LEDGER_VERIFY");
        return true;
      });
    } finally {
      client.close();
    }
  });
});

test("RefusedError maps connector drift refusal reports", () => {
  const error = RefusedError.fromReport({
    applied: [],
    refused: [{ stepId: "restore-1", reason: "drift", changed: [] }],
  });
  assert.ok(error instanceof RefusedError);
  assert.equal(error.code, "VOID_REFUSED");
  assert.equal(error.reason, "drift");
});


for (const scenario of ["trusted", "rehashed", "foreign-key"] as const) {
  test(`startup authenticates existing ledger: ${scenario}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "void-sdk-signatures-"));
    const workspace = "signed";
    const path = join(dir, `${workspace}.jsonl`);
    const marker = join(dir, "upstream-started");
    const signer = scenario === "foreign-key"
      ? await devKeyProvider({ dir: join(dir, "foreign-keys"), env: {} })
      : await devKeyProvider();
    await jsonlStore(signer, { dir }).append({ workspace, tool: "echo", decision: "deny" });
    if (scenario === "rehashed") {
      const entry = JSON.parse(await readFile(path, "utf8"));
      entry.body.decision = "allow";
      entry.hash = await entryHash(entry.body, entry.prev_hash, sha256Hex);
      await writeFile(path, `${JSON.stringify(entry)}\n`);
    }
    // A fresh hash chain also passes for forged content and an untrusted signer.
    assert.equal((await verifyLedgerFile(path)).ok, true);
    const client = new VoidClient({
      ledgerDir: dir, workspace, policyPath: await fixturePolicy(),
      connect: { upstreamCommand: scenario === "trusted"
        ? [process.execPath, "../../fixtures/e2e-server.mjs"]
        : [process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], 'started')", marker] },
      requestTimeoutMs: 1_000,
    });
    try {
      const request = client.request("tools/call", { name: "echo", arguments: { text: "authenticated" } });
      if (scenario === "trusted") {
        assert.equal(textFrom(await request), "authenticated");
      } else {
        await assert.rejects(request, LedgerVerifyError);
        await assert.rejects(access(marker), { code: "ENOENT" });
      }
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
