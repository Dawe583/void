import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Workbench } from "./index.ts";
import { page, filterRows, preferencePatch } from "./gui.ts";

test("cursor binds filters and preserves position when new rows arrive; finds old results", () => {
  const rows = Array.from({ length: 151 }, (_, i) => ({
    id: String(i),
    title: i === 150 ? "Old needle" : "Conversation",
  }));
  const first = page(rows, new URLSearchParams("limit=50"));
  const next = page(
    [{ id: "new", title: "New" }, ...rows],
    new URLSearchParams({ limit: "50", cursor: first.nextCursor! }),
  );
  assert.equal(next.items[0]!.id, "50");
  assert.equal(first.total, 151);
  assert.equal(
    page(
      filterRows(rows, new URLSearchParams("q=needle")),
      new URLSearchParams("q=needle"),
    ).items[0]!.id,
    "150",
  );
  assert.throws(
    () =>
      page(
        rows,
        new URLSearchParams({ q: "changed", cursor: first.nextCursor! }),
      ),
    /cursor/,
  );
  assert.throws(() => preferencePatch({ appearance: "unknown" }), /appearance/);
});

test("GUI edits use revisions and signed undo, branches do not replay tools, requests survive restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "void-gui-"));
  let requests = 0;
  const fetcher: typeof fetch = async (url) =>
    String(url).endsWith("/models")
      ? Response.json({ data: [{ id: "test" }] })
      : (requests++,
        Response.json({
          choices: [{ message: { role: "assistant", content: "Complete." } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
  let wb = new Workbench({ VOID_DATA_DIR: directory }, fetcher);
  t.after(async () => {
    wb.close();
    await rm(directory, { recursive: true, force: true });
  });
  await wb.configure({
    baseUrl: "https://provider.test/v1",
    apiKey: "secret-test",
  });
  const session = await wb.start("First", "test", "request-one");
  while (wb.get(session.id)?.status === "running") await delay(5);
  assert.equal((await wb.start("First", "test", "request-one")).id, session.id);
  assert.equal(requests, 1);
  await assert.rejects(
    wb.start("Different", "test", "request-one"),
    /another request/,
  );
  const first = await wb.editDocument(session.id, {
    path: "notes.md",
    content: "First version",
    expectedRevision: null,
  });
  await assert.rejects(
    wb.editDocument(session.id, {
      path: "notes.md",
      content: "Overwrite",
      expectedRevision: null,
    }),
    /revision conflict/,
  );
  const second = await wb.editDocument(session.id, {
    path: "notes.md",
    content: "Second version",
    expectedRevision: first.revision,
  });
  assert.equal((await wb.ledger(session.workspace))?.result.ok, true);
  const child = await wb.branch(session.id, {
    seq: 1,
    prompt: "Edited prompt",
    snapshotDocuments: true,
  });
  assert.equal(child.status, "idle");
  assert.equal(requests, 1);
  assert.equal(wb.document(child.id, "notes.md").content, "Second version");
  assert.equal((await wb.ledger(child.workspace))?.result.ok, true);
  assert.equal(
    (await wb.undoPreview(session.id, second.revision!)).canApply,
    true,
  );
  await wb.undo(session.id, second.revision!);
  assert.equal(wb.document(session.id, "notes.md").content, "First version");
  wb.patchSession(session.id, {
    title: "Renamed",
    pinned: true,
    archived: true,
  });
  wb.patchPreferences({ locale: "en" });
  wb.close();
  wb = new Workbench({ VOID_DATA_DIR: directory }, fetcher);
  assert.equal(wb.getPreferences().locale, "en");
  assert.equal(wb.sessionPage(new URLSearchParams("archived=true")).total, 1);
  assert.equal((await wb.start("First", "test", "request-one")).id, session.id);
  assert.equal(requests, 1);
});

test("provider 429 persists Retry-After and never retries the generation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "void-rate-"));
  let calls = 0;
  const wb = new Workbench({ VOID_DATA_DIR: directory }, async (url) =>
    String(url).endsWith("/models")
      ? Response.json({ data: [{ id: "test" }] })
      : (calls++,
        new Response("private provider failure", {
          status: 429,
          headers: { "retry-after": "7" },
        })),
  );
  t.after(async () => {
    wb.close();
    await rm(directory, { recursive: true, force: true });
  });
  await wb.configure({
    baseUrl: "https://provider.test/v1",
    apiKey: "test-secret",
  });
  const session = await wb.start("Hello", "test");
  while (wb.get(session.id)?.status === "running") await delay(5);
  const failure = wb
    .get(session.id)!
    .events.find((e) => e.type === "run.error");
  assert.equal(failure?.payload?.retryAfter, 7);
  assert.equal(failure?.payload?.status, 429);
  assert.equal(failure?.payload?.automaticRetry, false);
  assert.equal(calls, 1);
  assert.doesNotMatch(failure?.text ?? "", /private provider failure/);
});

test("connector updates validate before commit, retain secret, expose schema, and test without execution", async (t) => {
  const { createServer } = await import("node:http");
  const directory = await mkdtemp(join(tmpdir(), "void-connector-"));
  const methods: string[] = [];
  let fail = false;
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    methods.push(body.method);
    assert.equal(req.headers.authorization, "Bearer connector-private");
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.statusCode = 503;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "search",
                    description: "connector-private",
                    inputSchema: {
                      type: "object",
                      properties: { q: { type: "string" } },
                    },
                  },
                ],
              }
            : {},
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const wb = new Workbench({ VOID_DATA_DIR: directory });
  t.after(async () => {
    wb.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await wb.addConnector({
    url: `http://127.0.0.1:${address.port}/mcp`,
    name: "Original",
    token: "connector-private",
    facts: { safe: true },
    mapping: { search: "search.read" },
  });
  const connector = wb
    .connectionState()
    .connectors.find((c) => c.id !== "workspace")!;
  const changed = await wb.updateConnector(connector.id, {
    name: "Changed",
    token: "",
    facts: { safe: false },
  });
  assert.equal(changed.name, "Changed");
  assert.equal(changed.toolDetails[0]?.name, "search");
  assert.doesNotMatch(JSON.stringify(changed), /connector-private/);
  assert.equal((await wb.testConnector(connector.id)).ok, true);
  assert.ok(
    methods.every((method) =>
      ["initialize", "notifications/initialized", "tools/list"].includes(
        method,
      ),
    ),
  );
  await assert.rejects(
    wb.updateConnector(connector.id, { mapping: { search: true } }),
    /mapping/,
  );
  fail = true;
  await assert.rejects(
    wb.updateConnector(connector.id, { name: "Should not persist" }),
    /HTTP 503/,
  );
  assert.equal(
    wb.connectionState().connectors.find((c) => c.id === connector.id)?.name,
    "Changed",
  );
});
