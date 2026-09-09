import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalBroker, ApprovalStateInUseError, loadPending, writeDecision } from "../../policy/src/approvals.ts";
import { HoldQueue } from "../../policy/src/hold.ts";
import { pumpApprovals } from "../../proxy/src/approval-loop.ts";
import { runApproveCommand, runApprovalsCommand } from "./approve.ts";

const call = { tool: "postgres.table.drop", klass: "r3", blastRadius: 1, ruleIndex: 0, rationale: "hold", args: { secret: "not persisted" }, notify: ["cli"] };
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(join(tmpdir(), "void-approve-"));
  const queue = new HoldQueue();
  const broker = new ApprovalBroker({ stateDir: dir });
  let notify = () => {};
  const pump = pumpApprovals(broker, { now: Date.now }, { watch: (_dir, callback) => { notify = callback; return { close() {} }; } });
  pump.onHold(queue);
  t.after(() => { pump.stop(); queue.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const promise = queue.hold(call, 60);
  return { dir, queue, broker, pump, promise, notify: () => notify() };
}

test("atomic decision round trip and broker pending flush", async (t) => {
  const f = fixture(t);
  const pending = loadPending(f.dir);
  assert.equal(pending.length, 1);
  assert.equal(fs.readFileSync(join(f.dir, "pending.json"), "utf8").includes("secret"), false);
  const operations: string[] = [];
  writeDecision(f.dir, pending[0]!.holdId, { kind: "approved", by: "me", reason: "reviewed" }, {
    ...fs,
    fsyncSync(fd) { operations.push("sync"); fs.fsyncSync(fd); },
    renameSync(from, to) { operations.push("rename"); fs.renameSync(from, to); },
  });
  assert.deepEqual(operations, ["sync", "rename", "sync"]);
  assert.equal(fs.readdirSync(join(f.dir, "decisions")).length, 1);
  f.notify();
  assert.deepEqual((await f.promise).outcome, { kind: "released", release: { kind: "approved" } });
  assert.equal(f.broker.get(pending[0]!.holdId)?.reason, "reviewed");
  assert.deepEqual(loadPending(f.dir), []);
  assert.deepEqual(fs.readdirSync(join(f.dir, "decisions")), []);
});

for (const deny of [false, true]) {
  test(`approve command queues ${deny ? "denial" : "approval"} honestly`, async (t) => {
    const f = fixture(t);
    const output: string[] = [];
    const io = { stdout: (line: string) => output.push(line), stderr: (line: string) => output.push(line) };
    assert.equal(await runApprovalsCommand(["--dir", f.dir, "--json"], io), 0);
    assert.equal(JSON.parse(output[0]!).length, 1);
    assert.equal(await runApproveCommand(["h0001", "--by", "me", "--dir", f.dir, ...(deny ? ["--deny"] : [])], io), 0);
    assert.match(output[1]!, /queued/);
    assert.equal(f.queue.list().length, 1);
    f.notify();
    assert.deepEqual((await f.promise).outcome, { kind: "released", release: deny ? { kind: "denied", by: "me" } : { kind: "approved" } });
  });
}

test("approve rejects missing id, actor, invalid options and unknown holds", async (t) => {
  const f = fixture(t);
  const io = { stdout() {}, stderr() {} };
  for (const args of [[], ["--by", "me"], ["h0001"], ["h0001", "--by", "me", "--wat"]]) {
    assert.equal(await runApproveCommand(args, io), 2);
  }
  assert.equal(await runApproveCommand(["absent", "--by", "me", "--dir", f.dir], io), 1);
  assert.throws(() => writeDecision(f.dir, "../escape", { kind: "approved", by: "me" }));
});

test("stale decision cannot approve reused hold id after broker restart", async (t) => {
  const f = fixture(t);
  writeDecision(f.dir, "h0001", { kind: "approved", by: "old" });
  f.pump.stop();
  const queue = new HoldQueue();
  const broker = new ApprovalBroker({ stateDir: f.dir });
  const pump = pumpApprovals(broker, { now: Date.now }, { watch: () => ({ close() {} }) });
  pump.onHold(queue);
  try {
    void queue.hold(call, 60);
    pump.poll();
    assert.equal(queue.list().length, 1);
    assert.equal(broker.get("h0001")?.status, "pending");
  } finally { pump.stop(); queue.close(); }
});

test("malformed decisions fail closed and expiry clears persisted pending", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(join(f.dir, "decisions", "bad.json"), "{", { mode: 0o600 });
  f.notify();
  assert.notDeepEqual((await f.promise).outcome, { kind: "released", release: { kind: "approved" } });
  assert.deepEqual(loadPending(f.dir), []);
});

test("failed atomic rename leaves no partial decision or temporary file", (t) => {
  const f = fixture(t);
  assert.throws(() => writeDecision(f.dir, "h0001", { kind: "approved", by: "me" }, {
    ...fs, renameSync() { throw new Error("disk failure"); },
  }), /disk failure/);
  assert.deepEqual(fs.readdirSync(join(f.dir, "decisions")), []);
  assert.equal(f.queue.list().length, 1);
});

test("expired hold cannot be approved even before its timer executes", async (t) => {
  const f = fixture(t);
  const expiresAt = f.broker.get("h0001")!.expiresAt;
  assert.throws(() => writeDecision(f.dir, "h0001", { kind: "approved", by: "me" }, fs, () => expiresAt), /expired/);
  f.pump.poll(expiresAt);
  assert.equal((await f.promise).outcome.kind, "expired");
  assert.deepEqual(loadPending(f.dir), []);
});

test("invalid decision kind cannot release an in-process hold", (t) => {
  const f = fixture(t);
  assert.throws(() => f.broker.decide("h0001", { kind: "allow", by: "me" } as never), /invalid/);
  assert.equal(f.queue.list().length, 1);
});

test("preexisting permissive and symlink state directories are rejected", (t) => {
  const base = fs.mkdtempSync(join(tmpdir(), "void-approve-perms-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const unsafe = join(base, "unsafe");
  fs.mkdirSync(unsafe, { mode: 0o777 });
  fs.chmodSync(unsafe, 0o777);
  assert.throws(() => new ApprovalBroker({ stateDir: unsafe }), /owner-only/);
  fs.chmodSync(unsafe, 0o700);
  fs.symlinkSync(unsafe, join(base, "linked"));
  assert.throws(() => new ApprovalBroker({ stateDir: join(base, "linked") }), /owner-only/);
});

test("a second proxy refuses the state directory with a typed error", (t) => {
  const f = fixture(t);
  assert.throws(() => new ApprovalBroker({ stateDir: f.dir }), ApprovalStateInUseError);
  assert.equal(f.queue.list().length, 1);
  f.pump.stop();
  const replacement = new ApprovalBroker({ stateDir: f.dir });
  replacement.close();
});

test("default watcher consumes a decision while the held call waits", async (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "void-approve-watch-"));
  const queue = new HoldQueue();
  const broker = new ApprovalBroker({ stateDir: dir });
  const failures: string[] = [];
  const pump = pumpApprovals(broker, { now: Date.now }, {
    onError(error) { failures.push(String(error)); },
  });
  pump.onHold(queue);
  t.after(() => { pump.stop(); queue.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const resolution = queue.hold(call, 60);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("watcher did not consume decision")), 3000);
  });
  try {
    writeDecision(dir, "h0001", { kind: "approved", by: "default watcher" });
    assert.deepEqual((await Promise.race([resolution, deadline])).outcome,
      { kind: "released", release: { kind: "approved" } }, JSON.stringify(failures));
  } finally { clearTimeout(timeout); }
});
