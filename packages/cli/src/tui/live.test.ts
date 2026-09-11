import test from "node:test";
import assert from "node:assert/strict";
import { renderLiveFeed, liveRecords, type LiveView } from "./live.ts";
import { visibleLength } from "./layout.ts";

const view: LiveView = { workspace: "local", selected: 0, filter: "", paused: false, detail: false, help: false,
  page: { verified: true, signed: true, head: "a".repeat(64), records: [
    { seq: 1, at: "2026-09-11", tool: "postgres.row.update", klass: "r1", decision: "allow:resolved", argsDigest: "b".repeat(64), prevDigest: "0".repeat(64), digest: "a".repeat(64) },
  ] } };

for (const columns of [80, 120, 200]) test(`live ledger is bounded at ${columns} columns`, () => {
  for (const changes of [{}, { detail: true }, { help: true }, { filter: "r3" }, { error: "offline", page: undefined }]) {
    const frame = renderLiveFeed({ ...view, ...changes }, { interactive: true, ansi: false, colorDepth: 0, columns, rows: 24, reason: "no-color" });
    assert.equal(frame.split("\n").length, 24);
    assert.ok(frame.split("\n").every(line => visibleLength(line) <= columns));
    assert.doesNotMatch(frame, /\u001b/);
    assert.match(frame, /q quit/);
  }
});

test("live view never labels integrity-only data as signature checked", () => {
  const frame = renderLiveFeed({ ...view, page: { ...view.page!, signed: false } }, { interactive: false, ansi: false, colorDepth: 0, columns: 80, rows: 24, reason: "not-tty" });
  assert.match(frame, /Signatures have not been checked/);
  assert.equal(liveRecords({ ...view, filter: "r3" }).length, 0);
});

test('pending approvals expose real risk and require an explicit confirmation', () => {
  const hold = { holdId: 'h001', call: { tool: 'postgres.row.delete', klass: 'r3' as const, connector: 'postgres', workspace: 'local', blastRadius: 12 }, expiresAt: Date.now() + 60000, status: 'pending' as const, notify: [] };
  const frame = renderLiveFeed({ ...view, approvalView: true, approvals: [hold], approvalSelected: 0, confirmDecision: 'denied' }, { interactive: true, ansi: false, colorDepth: 0, columns: 80, rows: 24, reason: 'no-color' });
  assert.match(frame, /Blast radius: 12/);
  assert.match(frame, /Confirm denied with y/);
  assert.ok(frame.split('\n').every(line => visibleLength(line) <= 80));
});
