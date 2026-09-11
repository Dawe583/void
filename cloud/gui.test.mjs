import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  database,
  write,
  encrypt,
  event,
  eventsAfter,
  sessionPage,
  ledgerPage,
  transaction,
  read,
} from "./store.mjs";
import { signer } from "./store.mjs";
import { entryHash, GENESIS_PREV } from "../packages/ledger/src/canonical.ts";
import { sha256Hex } from "../packages/ledger/src/sign.ts";
import { signingPreimage } from "../packages/ledger/src/index.ts";
import { createWorkspace } from "../packages/workbench/src/workspace.ts";

// Run only against an explicitly supplied isolated test database.
test(
  "cloud GUI retained history, indexed pages, revisions, branch and SSE",
  { skip: process.env.VOID_GUI_DATABASE_TEST !== "1" },
  async (t) => {
    const { default: app } = await import("./server.mjs");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await database().end();
    });
    const base = `http://127.0.0.1:${server.address().port}`,
      headers = {
        authorization: `Bearer ${process.env.VOID_CONTROL_TOKEN}`,
        "content-type": "application/json",
      };
    const request = async (path, method = "GET", body) => {
      const response = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };
    const prefix = randomUUID(),
      rows = Array.from({ length: 151 }, (_, i) => ({
        id: `${prefix}-${i}`,
        workspace: `agent-${prefix}-${i}`,
        title: `${prefix} ${i === 150 ? "needle" : "chat"}`,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
        status: "idle",
        model: "test",
        generation: 1,
        events: [],
        messages: [{ role: "system", content: "test" }],
        tools: [],
        provider: { mode: "tokenrouter" },
      }));
    for (const row of rows) await write(`session:${row.id}`, row);
    const session = rows[150];
    for (let i = 0; i < 1001; i++)
      event(session, i % 2 ? "assistant" : "user", `message ${i}`);
    await write(`session:${session.id}`, session);
    await write(`workspace:${session.id}`, encrypt(createWorkspace()));
    const first = await sessionPage(
      new URLSearchParams({ q: prefix, limit: "50" }),
    );
    assert.equal(first.total, 151);
    assert.equal(first.items.length, 50);
    assert.equal(first.items[0].events.length, 0);
    const second = await sessionPage(
      new URLSearchParams({ q: prefix, limit: "50", cursor: first.nextCursor }),
    );
    assert.equal(second.items.length, 50);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal(
      (await sessionPage(new URLSearchParams({ q: `${prefix} needle` })))
        .items[0].id,
      session.id,
    );
    assert.equal((await eventsAfter(session.id, 999)).length, 2);
    const edited = await request(
      `/api/sessions/${session.id}/documents`,
      "PATCH",
      { path: "notes.md", content: "Version one", expectedRevision: null },
    );
    assert.equal(edited.status, 200);
    assert.ok(edited.body.document.revision);
    const conflict = await request(
      `/api/sessions/${session.id}/documents`,
      "PATCH",
      { path: "notes.md", content: "Overwrite", expectedRevision: null },
    );
    assert.equal(conflict.status, 409);
    const branch = await request(
      `/api/sessions/${session.id}/branches`,
      "POST",
      { seq: 1, prompt: "Changed message", snapshotDocuments: true },
    );
    assert.equal(branch.status, 201);
    assert.equal(branch.body.session.status, "idle");
    assert.equal(branch.body.session.events[0].text, "Changed message");
    const copied = await request(
      `/api/sessions/${branch.body.session.id}/documents?path=notes.md`,
    );
    assert.equal(copied.body.document.content, "Version one");
    const proof = await request(
      `/api/ledger/verify?workspace=${session.workspace}`,
    );
    assert.equal(proof.body.verified, true);
    assert.equal(proof.body.checked, 6);
    const feed = await ledgerPage(session.workspace, new URLSearchParams());
    assert.equal(feed.items.length, 6);
    assert.equal(feed.verified, false);
    const undo = await request(
      `/api/sessions/${session.id}/undo/${edited.body.document.revision}`,
      "POST",
      { confirm: edited.body.document.revision },
    );
    assert.equal(undo.status, 200);
    const scaleWorkspace = `scale-${prefix}`,
      signed = [],
      key = await signer(),
      keyId = await key.currentKeyId();
    let previous = GENESIS_PREV;
    for (let seq = 1; seq <= 10000; seq++) {
      const body = {
          workspace: scaleWorkspace,
          at: new Date().toISOString(),
          tool: seq === 1 ? "old-needle" : "fixture",
          klass: "r0",
          decision: "allow",
        },
        hash = await entryHash(body, previous, sha256Hex);
      signed.push({
        workspace: scaleWorkspace,
        seq,
        body,
        prev_hash: previous,
        hash,
        key_id: keyId,
        alg: key.alg,
        signature: `${key.alg}:${Buffer.from(await key.sign(signingPreimage(key.alg, keyId, hash))).toString("base64")}`,
      });
      previous = hash;
    }
    await database().query(
      "INSERT INTO void_cloud_ledger(workspace,seq,entry) SELECT $1,(e->>'seq')::integer,e FROM jsonb_array_elements($2::jsonb) e",
      [scaleWorkspace, JSON.stringify(signed)],
    );
    const scalePage = await ledgerPage(
      scaleWorkspace,
      new URLSearchParams("limit=50"),
    );
    assert.equal(scalePage.total, 10000);
    assert.equal(scalePage.items.length, 50);
    assert.equal(scalePage.items[0].seq, 10000);
    const scaleNext = await ledgerPage(
      scaleWorkspace,
      new URLSearchParams({ limit: "50", cursor: scalePage.nextCursor }),
    );
    assert.equal(scaleNext.items[0].seq, 9950);
    assert.equal(
      (await ledgerPage(scaleWorkspace, new URLSearchParams("tool=old-needle")))
        .items[0].seq,
      1,
    );
    const scaleProof = await request(
      `/api/ledger/verify?workspace=${scaleWorkspace}`,
    );
    assert.equal(scaleProof.body.checked, 10000);
    assert.equal(scaleProof.body.verified, true);
    const stream = await fetch(
      `${base}/api/sessions/${session.id}/stream?after=1000`,
      { headers },
    );
    const reader = stream.body.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /id: 1001/);
    await reader.cancel();
    assert.equal((await read(`session:${session.id}`)).events.length, 200);
    assert.ok((await eventsAfter(session.id, 1000)).length >= 3);
  },
);
