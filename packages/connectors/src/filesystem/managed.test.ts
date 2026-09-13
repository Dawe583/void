import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
  chmod,
  stat,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { managedFilesystemAdapter } from "./managed.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  reservedRecoveryVault,
} from "../../../runtime/src/index.ts";
import { devKeyProvider } from "../../../ledger/src/sign.ts";
async function fixture(t: import("node:test").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "void-files-")),
    root = join(dir, "project");
  await mkdir(root);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} }),
    key = randomBytes(32);
  const adapter = () => managedFilesystemAdapter({ root, cooperative: true });
  const runtime = () =>
    recoveryRuntime({
      journal: localOperationJournal(join(dir, "journal"), signer),
      vault: reservedRecoveryVault(join(dir, "vault"), { key }, "key"),
      adapters: [adapter()],
      authorize: async () => true,
    });
  const execute = (
    action: "write" | "delete",
    path = "file",
    base64?: string,
  ) =>
    runtime().execute({
      workspace: "test",
      operationId: `op-${action}`,
      runId: "run",
      agentId: "agent",
      adapterId: "filesystem.managed",
      arguments: { action, path, ...(base64 === undefined ? {} : { base64 }) },
    });
  return { dir, root, adapter, runtime, execute };
}
test("real binary write and delete restore bytes/mode across restart and preserve other user files", async (t) => {
  const f = await fixture(t),
    original = randomBytes(5000);
  await writeFile(join(f.root, "file"), original, { mode: 0o751 });
  await writeFile(join(f.root, "human.txt"), "uncommitted human work");
  assert.equal(
    (await f.execute("write", "file", Buffer.from("new").toString("base64")))
      .status,
    "succeeded",
  );
  const restarted = f.runtime(),
    plan = await restarted.planRecovery("test", "op-write");
  assert.equal(
    (await restarted.recover(plan, async () => true)).status,
    "restored",
  );
  assert.deepEqual(await readFile(join(f.root, "file")), original);
  assert.equal((await stat(join(f.root, "file"))).mode & 0o777, 0o751);
  assert.equal(
    (await restarted.recover(plan, async () => true)).status,
    "restored",
  );
  assert.equal((await f.execute("delete")).status, "succeeded");
  assert.equal(
    (
      await f
        .runtime()
        .recover(
          await f.runtime().planRecovery("test", "op-delete"),
          async () => true,
        )
    ).status,
    "restored",
  );
  assert.deepEqual(await readFile(join(f.root, "file")), original);
  assert.equal(
    await readFile(join(f.root, "human.txt"), "utf8"),
    "uncommitted human work",
  );
  assert.ok(
    !(await readFile(join(f.dir, "journal/test.jsonl"), "utf8")).includes(
      original.toString("base64"),
    ),
  );
});
test("create Undo removes only the new file; same request is idempotent", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.execute("write", "file", "")).status, "succeeded");
  assert.equal((await f.execute("write", "file", "")).status, "succeeded");
  assert.equal(
    (
      await f
        .runtime()
        .recover(
          await f.runtime().planRecovery("test", "op-write"),
          async () => true,
        )
    ).status,
    "restored",
  );
  await assert.rejects(stat(join(f.root, "file")), { code: "ENOENT" });
});
test("external content, ABA and mode edits conflict instead of being overwritten", async (t) => {
  for (const change of ["content", "aba", "mode"]) {
    const f = await fixture(t);
    await writeFile(join(f.root, "file"), "before");
    await f.execute("write", "file", Buffer.from("agent").toString("base64"));
    if (change === "mode") await chmod(join(f.root, "file"), 0o700);
    else {
      await writeFile(join(f.root, "file"), "human");
      if (change === "aba") await writeFile(join(f.root, "file"), "agent");
    }
    assert.equal(
      (
        await f
          .runtime()
          .recover(
            await f.runtime().planRecovery("test", "op-write"),
            async () => true,
          )
      ).status,
      "conflict",
    );
  }
});
test("traversal, protected paths, symlinks, hardlinks and oversized files fail before dispatch", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "private"), "secret");
  await symlink(join(f.dir, "private"), join(f.root, "symbol"));
  await symlink(f.dir, join(f.root, "escape"));
  await link(join(f.dir, "private"), join(f.root, "hard"));
  await writeFile(join(f.root, "large"), Buffer.alloc(1024 * 1024 + 1));
  for (const path of [
    "../private",
    "/etc/passwd",
    ".git/config",
    ".env",
    "symbol",
    "escape/private",
    "hard",
    "large",
  ])
    await assert.rejects(
      f.adapter().preflight({ action: "write", path, base64: "" }),
    );
  await assert.rejects(
    f
      .adapter()
      .preflight({ action: "write", path: "file", base64: "invalid!" }),
  );
  assert.equal(await readFile(join(f.dir, "private"), "utf8"), "secret");
});
test("drift between prepare and dispatch refuses write; lost response remains unknown", async (t) => {
  const f = await fixture(t),
    adapter = f.adapter(),
    args = { action: "write", path: "file", base64: "" };
  await writeFile(join(f.root, "file"), "before");
  const observation = await adapter.preflight(args),
    prepared = await adapter.prepare(args, observation, "op");
  await writeFile(join(f.root, "file"), "human");
  await assert.rejects(adapter.execute(args, prepared, "op"), /conflict/);
  assert.deepEqual(await adapter.reconcile("op", prepared), {
    status: "unknown",
  });
  assert.equal(await readFile(join(f.root, "file"), "utf8"), "human");
});
