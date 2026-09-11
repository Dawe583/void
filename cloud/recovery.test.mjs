import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  database,
  transaction,
  read,
  write,
  decrypt,
  ledger,
} from "./store.mjs";
import { mutateCloudDocument, managedCloudUndo } from "./recovery.mjs";

test(
  "cloud managed documents commit evidence atomically, refuse drift and missing artifacts",
  {
    skip: process.env.VOID_GUI_DATABASE_TEST !== "1",
  },
  async () => {
    assert.equal(
      new URL(process.env.DATABASE_URL).pathname,
      "/void_gui_upgrade_preview",
    );
    const id = randomUUID(),
      session = { id, workspace: `agent-${id}` };
    const mutate = (operationId, content) =>
      transaction(id, (c) =>
        mutateCloudDocument(session, c, {
          id: operationId,
          name: "void_workspace_write",
          arguments: { path: "check.txt", content },
        }),
      );
    const state = async () => decrypt(await read(`workspace:${id}`));
    try {
      await mutate("first", "before");
      await mutate("second", "after");
      await assert.rejects(
        transaction(id, (c) => managedCloudUndo(session, c, "first")),
        /newer changes/,
      );
      assert.equal(
        await transaction(id, (c) => managedCloudUndo(session, c, "second")),
        true,
      );
      assert.equal((await state()).files["check.txt"], "before");
      const count = (await state()).operations.length;
      await transaction(id, (c) => managedCloudUndo(session, c, "second"));
      assert.equal((await state()).operations.length, count);
      const proof = await ledger(session.workspace);
      assert.ok(
        proof.entries.some((e) => e.body.runtimeEvent?.stage === "restored"),
      );
      await assert.rejects(
        transaction(id, async (c) => {
          await mutateCloudDocument(session, c, {
            id: "rollback",
            name: "void_workspace_write",
            arguments: { path: "check.txt", content: "must roll back" },
          });
          throw new Error("Injected transaction failure");
        }),
        /Injected transaction failure/,
      );
      assert.equal((await state()).files["check.txt"], "before");
      assert.equal(
        (await ledger(session.workspace)).entries.length,
        proof.entries.length,
      );
      await assert.rejects(
        transaction(id, async (c) => {
          const quota = await read(`recovery-quota:${id}`, c);
          await write(
            `recovery-quota:${id}`,
            { ...quota, bytes: 64 * 1024 * 1024 },
            c,
          );
          await mutateCloudDocument(session, c, {
            id: "no-space",
            name: "void_workspace_write",
            arguments: { path: "check.txt", content: "no space" },
          });
        }),
        /failed/,
      );
      assert.equal((await state()).files["check.txt"], "before");
      await assert.rejects(
        transaction(id, async (c) => {
          await c.query("DELETE FROM void_cloud_state WHERE key LIKE $1", [
            `recovery-artifact:${id}:%`,
          ]);
          await managedCloudUndo(session, c, "first");
        }),
        /artifact/,
      );
      await transaction(id, (c) => managedCloudUndo(session, c, "first"));
      assert.equal((await state()).files["check.txt"], undefined);
    } finally {
      // Keep this uniquely scoped evidence in the isolated append-only test ledger.
    await database().end();
  }
});
