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

test("feed uses real registry ids and has twelve calls", () => {
  const html = readPage("feed.html");
  const required = [
    "aws.s3.object.delete",
    "postgres.row.delete",
    "stripe.payment_intent.create",
    "slack.chat.post_message",
    "gmail.message.send",
    "github.pull_request.merge"
  ];
  for (const id of required) {
    assert.match(html, new RegExp(id.replaceAll(".", "\\.")), id);
  }
  assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 12);
  assert.match(html, /class="pending"/);
});

test("approvals expose labelled actions and the empty state", () => {
  const html = readPage("approvals.html");
  assert.equal((html.match(/aria-label="Approve /g) ?? []).length, 3);
  assert.equal((html.match(/aria-label="Deny /g) ?? []).length, 3);
  assert.match(html, /No held calls/);
});

test("ledger includes ten records and a verification interaction", () => {
  const html = readPage("ledger.html");
  assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 10);
  assert.match(html, /Verify status: not checked/);
  assert.match(html, /Verify status: verified, 10 records linked/);
  assert.match(html, /addEventListener\("click"/);
});

test("filenames are the assigned page set", () => {
  assert.deepEqual(pages.map((page) => basename(page)), ["index.html", "feed.html", "approvals.html", "ledger.html"]);
});
