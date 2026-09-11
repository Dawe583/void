import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { Workbench } from "./index.ts";
import { digest } from "../../runtime/src/index.ts";
async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "void-doc-runtime-"));
  const fetcher: typeof fetch = async (url) =>
    String(url).endsWith("/models")
      ? Response.json({ data: [{ id: "test" }] })
      : Response.json({
          choices: [{ message: { role: "assistant", content: "done" } }],
        });
  let app = new Workbench({ VOID_DATA_DIR: root }, fetcher);
  await app.configure({
    baseUrl: "https://provider.test/v1",
    apiKey: "fixture",
  });
  const session = await app.start("Test", "test");
  while (app.get(session.id)?.status === "running") await delay(5);
  t.after(async () => {
    app.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    session,
    get app() {
      return app;
    },
    restart() {
      app.close();
      app = new Workbench({ VOID_DATA_DIR: root }, fetcher);
      return app;
    },
  };
}
test("document edits and sequential Undo use signed runtime after restart without changing legacy history format", async (t) => {
  const f = await fixture(t),
    a = await f.app.editDocument(f.session.id, {
      path: "note.md",
      content: "first",
      expectedRevision: null,
    });
  const b = await f.app.editDocument(f.session.id, {
    path: "note.md",
    content: "second",
    expectedRevision: a.revision,
  });
  const app = f.restart();
  assert.equal(
    (await app.undoPreview(f.session.id, b.revision!)).canApply,
    true,
  );
  await app.undo(f.session.id, b.revision!);
  assert.equal(app.document(f.session.id, "note.md").content, "first");
  await app.undo(f.session.id, a.revision!);
  assert.equal(app.workspace(f.session.id).files["note.md"], undefined);
  await app.undo(f.session.id, a.revision!);
  assert.equal(app.workspace(f.session.id).operations.length, 4);
  assert.equal((await app.ledger(f.session.workspace))?.result.ok, true);
  const events = (
    await readFile(
      join(f.root, "recovery", "journal", f.session.workspace + ".jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).body);
  for (const id of [a.revision, b.revision])
    assert.equal(
      events.filter((event) => event.operationId === digest(id)).at(-1).stage,
      "restored",
    );
  assert.equal(
    events.some((event) => JSON.stringify(event).includes("second")),
    false,
  );
});
test("capture persistence failure prevents document mutation and leaves existing signed history intact", async (t) => {
  const f = await fixture(t),
    a = await f.app.editDocument(f.session.id, {
      path: "note.md",
      content: "first",
      expectedRevision: null,
    });
  const db = new DatabaseSync(
    join(f.root, "recovery", "vault", "vault.sqlite"),
  );
  db.exec(
    "CREATE TRIGGER fail_capture BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT,'injected storage failure'); END",
  );
  db.close();
  await assert.rejects(
    f.app.editDocument(f.session.id, {
      path: "note.md",
      content: "lost",
      expectedRevision: a.revision,
    }),
    /operation failed/,
  );
  assert.equal(f.app.document(f.session.id, "note.md").content, "first");
  assert.equal(f.app.workspace(f.session.id).operations.length, 1);
  assert.equal((await f.app.ledger(f.session.workspace))?.result.ok, true);
});
test("newer human edits block managed Undo and independent documents remain untouched", async (t) => {
  const f = await fixture(t),
    a = await f.app.editDocument(f.session.id, {
      path: "note.md",
      content: "a",
      expectedRevision: null,
    });
  const b = await f.app.editDocument(f.session.id, {
    path: "note.md",
    content: "b",
    expectedRevision: a.revision,
  });
  await f.app.editDocument(f.session.id, {
    path: "other.md",
    content: "keep",
    expectedRevision: null,
  });
  assert.equal(
    (await f.app.undoPreview(f.session.id, a.revision!)).canApply,
    false,
  );
  await assert.rejects(f.app.undo(f.session.id, a.revision!), /changed/);
  assert.equal(f.app.document(f.session.id, "note.md").content, "b");
  assert.equal(f.app.document(f.session.id, "other.md").content, "keep");
  await f.app.undo(f.session.id, b.revision!);
  assert.equal(f.app.document(f.session.id, "note.md").content, "a");
  await f.app.undo(f.session.id, a.revision!);
  assert.equal(f.app.workspace(f.session.id).files["note.md"], undefined);
});
test("missing managed journal cannot silently fall back to legacy Undo", async (t) => {
  const f = await fixture(t),
    edit = await f.app.editDocument(f.session.id, {
      path: "note.md",
      content: "retain",
      expectedRevision: null,
    });
  await rm(join(f.root, "recovery", "journal", f.session.workspace + ".jsonl"));
  await assert.rejects(
    f.app.undoPreview(f.session.id, edit.revision!),
    /journal is missing/,
  );
  assert.equal(f.app.document(f.session.id, "note.md").content, "retain");
});
test("previously signed document operations without runtime markers retain legacy Undo after restart", async (t) => {
  const f = await fixture(t),
    { executeWorkspaceTool } = await import("./workspace.ts");
  const args = { path: "old.md", content: "legacy" };
  const change = executeWorkspaceTool(f.app.workspace(f.session.id), {
    id: "legacy-operation",
    name: "void_workspace_write",
    arguments: args,
  });
  // Reuse the unchanged legacy commit boundary to create a pre-runtime record.
  const legacy = f.app as unknown as {
    sessions: Map<string, unknown>;
    commitWorkspace(...args: unknown[]): Promise<void>;
  };
  await legacy.commitWorkspace(
    legacy.sessions.get(f.session.id),
    change.state,
    "void_workspace_write",
    args,
    "execute:completed",
    change.operation,
  );
  const app = f.restart();
  assert.equal(
    (await app.undoPreview(f.session.id, "legacy-operation")).canApply,
    true,
  );
  await app.undo(f.session.id, "legacy-operation");
  assert.equal(app.workspace(f.session.id).files["old.md"], undefined);
  assert.equal((await app.ledger(f.session.workspace))?.result.ok, true);
});
