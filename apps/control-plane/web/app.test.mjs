import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenControlPlane } from "../api/server.ts";
import { devKeyProvider } from "../../../packages/ledger/src/sign.ts";
import { jsonlStore } from "../../../packages/ledger/src/store.ts";
import { feedUrl, decisionRequest, decisionState, renderFeed, renderApprovals, renderVerification, createApp } from "./app.js";

const entry = { seq: 1, at: "2026-09-01T00:00:00.000Z", tool: "postgres.row.update", klass: "r1", decision: "allow:resolved", digest: "a".repeat(64) };
const approval = { holdId: "hold/1", status: "pending", expiresAt: 5000, call: { tool: "postgres.row.delete", klass: "r3", workspace: "default", blastRadius: 4 } };
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

function harness(fetchImpl) {
  const nodes = new Map(["feed-scope", "feed-list", "approvals-list", "verify-status", "last-updated", "decision-status"].map(id => [id, { innerHTML: "", textContent: "" }]));
  let tick;
  let cleared;
  const app = createApp({
    document: { getElementById: id => nodes.get(id) ?? null },
    fetch: fetchImpl, now: () => 1000,
    timer: { setInterval: (callback, ms) => { tick = callback; assert.equal(ms, 2000); return 7; }, clearInterval: id => { cleared = id; } },
    page: "index", workspace: "default", limit: 50,
  });
  return { app, nodes, tick: () => tick(), cleared: () => cleared };
}

test("URL and decision builders encode identifiers and fix decision attribution", () => {
  assert.equal(feedUrl("team & ops", 2), "/api/feed?workspace=team+%26+ops&limit=2");
  assert.equal(feedUrl(undefined, 50), "/api/feed?limit=50");
  assert.throws(() => feedUrl("default", 0), /limit/);
  const request = decisionRequest("hold/1", "approved");
  assert.equal(request.url, "/api/approvals/hold%2F1/decision");
  assert.deepEqual(JSON.parse(request.options.body), { kind: "approved", by: "control-plane" });
  assert.throws(() => decisionRequest("x", "allow"), /decision/);
});

test("decision state cannot resubmit before a refresh or unlock during a POST", () => {
  assert.equal(decisionState("idle", "submit"), "submitting");
  assert.equal(decisionState("submitting", "refresh"), "submitting");
  assert.equal(decisionState("submitting", "success"), "submitted");
  assert.equal(decisionState("submitted", "submit"), "submitted");
  assert.equal(decisionState("submitted", "refresh"), "idle");
  assert.equal(decisionState("submitting", "failure"), "error");
});

test("feed rows show actual fields, short digests, empty and escaped error states", () => {
  const html = renderFeed([entry]);
  for (const value of ["<td>1</td>", entry.at, entry.tool, "R1", "info", entry.decision, "aaaaaaaaaaaa..."]) assert.ok(html.includes(value));
  assert.ok(!html.includes(entry.digest));
  assert.match(renderFeed([]), /No ledger entries/);
  assert.match(renderFeed([], "<offline>"), /Error: &lt;offline&gt;/);
  assert.doesNotMatch(renderFeed([{ ...entry, tool: '<img src=x onerror="attack()">' }]), /<img/);
});

test("approval rows escape API strings and disable expired or submitted holds", () => {
  const html = renderApprovals([approval], 1000);
  assert.match(html, /4 seconds remaining/);
  assert.match(html, /Blast radius: 4/);
  assert.match(html, /data-decision="approved"/);
  assert.equal((renderApprovals([approval], 5000).match(/ disabled/g) ?? []).length, 2);
  assert.equal((renderApprovals([approval], 1000, new Map([[approval.holdId, "submitting"]])).match(/ disabled/g) ?? []).length, 2);
  assert.match(renderApprovals([{ ...approval, status: "denied" }], 1000), /No pending holds/);
  assert.doesNotMatch(renderApprovals([{ ...approval, holdId: '" onclick="bad()', call: { ...approval.call, tool: "<script>bad()</script>" } }], 1000), /<script>|data-hold-id=""/);
});

test("verification succeeds only for explicit positive API proof", () => {
  assert.match(renderVerification({ ok: true, verified: true, checked: 2 }), /chain ok/);
  for (const body of [{ ok: false }, { ok: true, verified: false }, {}, null]) assert.match(renderVerification(body), /VERIFICATION FAILED/);
  assert.match(renderVerification(null, "offline"), /error.*VERIFICATION FAILED.*offline/);
});

test("refresh injects its clock, stamps completion, and stops its timer", async () => {
  const h = harness(async url => response(url.startsWith("/api/feed") ? { entries: [entry], verified: true } : url.startsWith("/api/approvals") ? { approvals: [approval] } : { ok: true, verified: true, checked: 1 }));
  await h.app.start();
  assert.match(h.nodes.get("feed-list").innerHTML, /postgres.row.update/);
  assert.match(h.nodes.get("approvals-list").innerHTML, /postgres.row.delete/);
  assert.match(h.nodes.get("last-updated").textContent, /Last updated: 1970-01-01T00:00:01.000Z/);
  await h.tick();
  h.app.stop();
  assert.equal(h.cleared(), 7);
});

test("failed fetches replace stale content with visible errors", async () => {
  let fail = false;
  const h = harness(async url => {
    if (fail) throw new Error("offline");
    return response(url.startsWith("/api/feed") ? { entries: [entry], verified: true } : url.startsWith("/api/approvals") ? { approvals: [approval] } : { ok: true, verified: true, checked: 1 });
  });
  await h.app.refresh();
  fail = true;
  await h.app.refresh();
  assert.match(h.nodes.get("feed-list").innerHTML, /Error: offline/);
  assert.doesNotMatch(h.nodes.get("feed-list").innerHTML, /postgres.row.update/);
  assert.match(h.nodes.get("approvals-list").innerHTML, /Error: offline/);
  assert.match(h.nodes.get("verify-status").innerHTML, /VERIFICATION FAILED/);
  assert.match(h.nodes.get("last-updated").textContent, /refresh failed/i);
});

test("HTTP and malformed responses are honest errors, not empty success", async () => {
  for (const fetchImpl of [async () => response({}, false, 503), async () => response({ entries: [entry], verified: false, approvals: [{}] })]) {
    const h = harness(fetchImpl);
    assert.equal(await h.app.pollFeed("default", 50), false);
    assert.equal(await h.app.pollApprovals(), false);
    assert.match(h.nodes.get("feed-list").innerHTML, /Error:/);
    assert.match(h.nodes.get("approvals-list").innerHTML, /Error:/);
  }
});

test("double clicks and refresh during a POST cannot submit twice", async () => {
  let finish;
  let posts = 0;
  const h = harness(async (url, options) => {
    if (options?.method === "POST") { posts++; return new Promise(resolve => { finish = resolve; }); }
    return response({ approvals: [approval] });
  });
  await h.app.pollApprovals();
  const first = h.app.decide(approval.holdId, "approved");
  assert.equal(await h.app.decide(approval.holdId, "denied"), false);
  await h.app.pollApprovals();
  assert.equal((h.nodes.get("approvals-list").innerHTML.match(/ disabled/g) ?? []).length, 2);
  finish(response({ ok: true, result: true }));
  assert.equal(await first, true);
  assert.equal(await h.app.decide(approval.holdId, "denied"), false);
  assert.equal(posts, 1);
});

test("API rejected decision is not shown as accepted", async () => {
  const h = harness(async (url, options) => response(options?.method === "POST" ? { ok: true, result: false } : { approvals: [approval] }));
  await h.app.pollApprovals();
  assert.equal(await h.app.decide(approval.holdId, "approved"), false);
  assert.match(h.nodes.get("decision-status").innerHTML, /Error:.*not accepted/);
});

test("real server supplies feed shape and serves only the public browser module", async () => {
  const dir = await mkdtemp(join(tmpdir(), "void-ui-"));
  let handle;
  try {
    const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
    const store = jsonlStore(signer, { dir });
    await store.append({ workspace: "default", ...entry, argsDigest: "b".repeat(64) });
    handle = await listenControlPlane({ ledgerPath: join(dir, "default.jsonl"), env: {} });
    const origin = `http://127.0.0.1:${handle.port}`;
    const feed = await fetch(origin + feedUrl("default", 1));
    const body = await feed.json();
    assert.equal(feed.status, 200);
    assert.equal(body.verified, false);
    assert.equal(body.integrity, true);
    assert.equal(body.signed, false);
    assert.equal(body.entries[0].tool, entry.tool);
    assert.match(body.entries[0].digest, /^[a-f0-9]{64}$/);
    assert.match(renderFeed(body.entries), /postgres.row.update/);
    const module = await fetch(origin + "/app.js");
    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type"), /javascript/);
    assert.match(await module.text(), /export function createApp/);
    assert.equal((await fetch(origin + "/app.test.mjs")).status, 404);
  } finally {
    if (handle) await handle.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("all pages load the module and have honest initial states", async () => {
  for (const page of ["index", "feed", "approvals", "ledger"]) {
    const html = await readFile(new URL(`./${page}.html`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`type="module" src="app.js" data-page="${page}"`));
    assert.match(html, /id="last-updated"/);
    assert.match(html, /id="verify-status"/);
    assert.doesNotMatch(html, /09:41:|1201|verified, 10 records linked|143 objects/);
  }
});

test("verification renders integrity-only results without claiming proof", () => {
  // Chain ok but no signature key: the badge must say what was and was not
  // checked instead of presenting integrity as authentication.
  const integrityOnly = renderVerification({ ok: true, verified: false, integrity: true, signed: false, checked: 2, head: "0".repeat(64) });
  assert.match(integrityOnly, /integrity only/);
  assert.match(integrityOnly, /no signature key/);
  assert.ok(!integrityOnly.includes("chain ok:"), "integrity view must not reuse the chain ok wording");

  const signed = renderVerification({ ok: true, verified: true, integrity: true, signed: true, checked: 2, head: "0".repeat(64) });
  assert.match(signed, /chain ok, signatures checked/);
});


test("integrity-only API feeds stay visible without claiming signature verification", async () => {
  const h = harness(async () => response({ entries: [entry], verified: false, integrity: true, signed: false }));
  assert.equal(await h.app.pollFeed("default", 50), true);
  assert.match(h.nodes.get("feed-list").innerHTML, /postgres.row.update/);
  assert.match(h.nodes.get("feed-scope").innerHTML, /hash chain integrity only/);
  assert.doesNotMatch(h.nodes.get("feed-scope").innerHTML, /feed verified/);
});

test("record inspector escapes content and distinguishes unsigned evidence", async () => {
  const { renderRecord } = await import("./app.js");
  const html = renderRecord({ ...entry, tool: '<script>alert(1)</script>', argsDigest: 'b'.repeat(64) }, false);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Signatures have not been checked/);
  assert.match(html, /b{64}/);
});
