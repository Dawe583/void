import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { recoveryMcpServer, type RecoveryTool } from "./recovery-mcp.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type RecoveryAdapter,
  type Json,
} from "../../runtime/src/index.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";

test("MCP client executes, previews and restores through signed runtime; policy and workspace cannot be supplied by agent", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-mcp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  let value: Json = { value: "before" },
    writes = 0;
  const adapter: RecoveryAdapter = {
    id: "postgres",
    version: "1",
    async preflight() {
      return {
        effect: "write",
        reversibility: "r1",
        readiness: "verified",
        scope: "fixture",
        resources: ["row"],
        revision: value,
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare(args) {
      return { before: value, plan: args };
    },
    async execute(args) {
      writes++;
      value = args;
      return { result: value, evidence: null };
    },
    async release() {},
    async reconcile() {
      return { status: "unknown" };
    },
    async recover(prepared) {
      value = prepared.before;
      return { status: "restored", evidence: value };
    },
  };
  const runtime = recoveryRuntime({
    journal: localOperationJournal(join(dir, "journal"), signer),
    vault: localRecoveryVault(
      join(dir, "vault"),
      { key: randomBytes(32) },
      "key",
    ),
    adapters: [adapter],
    authorize: async () => true,
  });
  const denied = new Set<RecoveryTool>();
  const server = recoveryMcpServer({
    runtime,
    workspace: "test",
    agentId: "host",
    adapterId: "postgres",
    permitted: async (name) => !denied.has(name),
  });
  const client = new Client({ name: "integration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  assert.equal((await client.listTools()).tools.length, 5);
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const payload = (r: Awaited<ReturnType<typeof call>>) =>
    JSON.parse((r.content as { text: string }[])[0]!.text);
  const input = {
    operationId: "op",
    runId: "run",
    mutation: { value: "after" },
  };
  assert.equal(
    (await call("void_execute", { ...input, workspace: "other" })).isError,
    true,
  );
  assert.equal(writes, 0);
  denied.add("void_execute");
  assert.equal((await call("void_execute", input)).isError, true);
  assert.equal(writes, 0);
  denied.clear();
  assert.equal(payload(await call("void_execute", input)).status, "succeeded");
  assert.equal(payload(await call("void_execute", input)).status, "succeeded");
  assert.equal(writes, 1);
  const plan = payload(await call("void_recovery_plan", { operationId: "op" }));
  assert.equal(
    (
      await call("void_recovery_apply", {
        plan: { ...plan, workspace: "other" },
      })
    ).isError,
    true,
  );
  denied.add("void_recovery_apply");
  assert.equal((await call("void_recovery_apply", { plan })).isError, true);
  assert.deepEqual(value, { value: "after" });
  denied.clear();
  assert.equal(
    payload(await call("void_recovery_apply", { plan })).status,
    "restored",
  );
  assert.deepEqual(value, { value: "before" });
  assert.equal(
    payload(await call("void_recovery_apply", { plan })).status,
    "restored",
  );
  assert.equal(writes, 1);
});
test("actual CLI stdio process remains alive after initialize and denies writes without policy", async (t) => {
  const { writeFile } = await import("node:fs/promises");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const dir = await mkdtemp(join(tmpdir(), "void-mcp-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      workspace: "test",
      agentId: "test-agent",
      stateDir: "state",
      encryptionKeyEnv: "TEST_RECOVERY_KEY",
      postgres: {
        urlEnv: "TEST_DATABASE_URL",
        schema: "void_meta",
        tables: [
          { table: "public.account", primaryKey: ["id"], columns: ["balance"] },
        ],
      },
    }),
  );
  const client = new Client({ name: "stdio-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      new URL("../bin/void.mjs", import.meta.url).pathname,
      "recovery",
      "serve",
      "--config",
      config,
    ],
    env: {
      ...(process.env as Record<string, string>),
      TEST_RECOVERY_KEY: randomBytes(32).toString("base64"),
      TEST_DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    },
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 5);
  assert.equal(
    (
      await client.callTool({
        name: "void_execute",
        arguments: {
          operationId: "op",
          runId: "run",
          mutation: {
            table: "public.account",
            action: "delete",
            key: { id: 1 },
          },
        },
      })
    ).isError,
    true,
  );
  assert.equal((await client.listTools()).tools.length, 5);
});
