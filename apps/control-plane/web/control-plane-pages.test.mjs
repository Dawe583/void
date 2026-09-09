import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const pages = ["index.html", "feed.html", "approvals.html", "ledger.html"];

function readPage(name) {
  return readFileSync(join(here, name), "utf8");
}

test("all pages are standalone HTML5 documents with inline CSS", () => {
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /^<!doctype html>/i, page);
    assert.match(html, /<html lang="en">/, page);
    assert.match(html, /<meta charset="utf-8">/, page);
    assert.match(html, /<meta name="viewport"/, page);
    assert.match(html, /<style>[\s\S]*<\/style>/, page);
    assert.doesNotMatch(html, /<link\b[^>]*stylesheet/i, page);
    assert.doesNotMatch(html, /src="https?:/i, page);
    assert.doesNotMatch(html, /[\u2013\u2014]/u, page);
  }
});

test("navigation links every page to the other control plane pages", () => {
  for (const page of pages) {
    const html = readPage(page);
    for (const target of pages) {
      assert.match(html, new RegExp(`href="${target}"`), `${page} links to ${target}`);
    }
  }
});

test("feed starts without fabricated calls and loads the live module", () => {
  const html = readPage("feed.html");
  const rows = html.match(/<tbody id="feed-list"[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(rows, "feed has a live rendering target");
  assert.equal((rows.match(/<tr>/g) ?? []).length, 1);
  assert.match(rows, /<td colspan="6">Loading ledger entries from the API\.<\/td>/);
  assert.doesNotMatch(rows, /<td>\d|postgres\.|aws\.|stripe\./);
  assert.match(html, /<script type="module" src="app\.js" data-page="feed"><\/script>/);
  assert.match(html, /id="last-updated"[^>]*>Not updated yet\. Connecting to the API\./);
});

test("approvals start without actionable holds until the API responds", () => {
  const html = readPage("approvals.html");
  assert.match(html, /id="approvals-list"[^>]*><p>Loading pending holds from the API\.<\/p><\/div>/);
  assert.equal((html.match(/aria-label="Approve /g) ?? []).length, 0);
  assert.equal((html.match(/aria-label="Deny /g) ?? []).length, 0);
  assert.doesNotMatch(html, /data-hold-id=|Countdown: expires/);
  assert.match(html, /id="decision-status" role="status" aria-live="polite"/);
  assert.match(html, /<script type="module" src="app\.js" data-page="approvals"><\/script>/);
});

test("ledger starts unverified without fabricated records and loads live verification", () => {
  const html = readPage("ledger.html");
  const rows = html.match(/<tbody id="feed-list"[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(rows, "ledger has a live rendering target");
  assert.equal((rows.match(/<tr>/g) ?? []).length, 1);
  assert.match(rows, /<td colspan="6">Loading ledger entries from the API\.<\/td>/);
  assert.doesNotMatch(rows, /<td>\d/);
  assert.match(html, /id="verify-status" role="status">Verification not checked\./);
  assert.match(html, /id="verify-button">Refresh now<\/button>/);
  assert.match(html, /<script type="module" src="app\.js" data-page="ledger"><\/script>/);
  assert.doesNotMatch(html, /verified, 10 records linked|addEventListener/);
});

test("filenames are the assigned page set", () => {
  assert.deepEqual(pages.map((page) => basename(page)), ["index.html", "feed.html", "approvals.html", "ledger.html"]);
});
