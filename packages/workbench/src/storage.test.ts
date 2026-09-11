import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from './storage.ts';

function directory(t: { after: (fn: () => void) => void }): string {
  const path = mkdtempSync(join(tmpdir(), 'void-storage-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(child.status, 0);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  return child.pid;
}

test('storage recovers a lock whose owning process has exited and commits encrypted state', t => {
  const dir = directory(t), store = new LocalStorage(dir), lock = join(dir, 'workspace.enc.lock');
  writeFileSync(lock, String(deadPid()));
  store.save({ document: 'captured content', evidence: ['signed row'] });
  assert.equal(existsSync(lock), false);
  assert.deepEqual(new LocalStorage(dir).read(), { document: 'captured content', evidence: ['signed row'] });
  assert.equal(readFileSync(join(dir, 'workspace.enc')).includes(Buffer.from('captured content')), false);
});

test('storage refuses a live or unknown lock owner without changing existing ciphertext', t => {
  const dir = directory(t), store = new LocalStorage(dir), lock = join(dir, 'workspace.enc.lock');
  store.save({ revision: 1 });
  const original = readFileSync(join(dir, 'workspace.enc'));
  for (const owner of [String(process.pid), '', 'not-a-pid', '-1', '2147483648']) {
    writeFileSync(lock, owner);
    assert.throws(() => store.save({ revision: 2 }), /locked|unknown owner/);
    assert.equal(readFileSync(lock, 'utf8'), owner);
    assert.deepEqual(readFileSync(join(dir, 'workspace.enc')), original);
    unlinkSync(lock);
  }
});

test('storage does not remove a lock replaced while its former owner is checked', t => {
  const dir = directory(t), store = new LocalStorage(dir), lock = join(dir, 'workspace.enc.lock');
  const pid = deadPid();
  writeFileSync(lock, String(pid));
  t.mock.method(process, 'kill', () => {
    unlinkSync(lock);
    writeFileSync(lock, String(process.pid));
    throw Object.assign(new Error('Owner exited'), { code: 'ESRCH' });
  });
  assert.throws(() => store.save({ revision: 1 }), /changed during recovery/);
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid));
  assert.equal(existsSync(join(dir, 'workspace.enc')), false);
});

test('storage rejects stale writers and preserves the latest complete snapshot', t => {
  const dir = directory(t), first = new LocalStorage(dir);
  first.save({ document: 'first', evidence: ['one'] });
  const second = new LocalStorage(dir);
  second.read();
  first.save({ document: 'second', evidence: ['one', 'two'] });
  assert.throws(() => second.save({ document: 'stale', evidence: ['one'] }), /changed in another runtime/);
  assert.deepEqual(new LocalStorage(dir).read(), { document: 'second', evidence: ['one', 'two'] });
  assert.equal(existsSync(join(dir, 'workspace.enc.lock')), false);
  assert.equal(statSync(join(dir, 'workspace.enc')).mode & 0o077, 0);
});

test('failed serialization leaves the atomic document and evidence snapshot unchanged', t => {
  const dir = directory(t), store = new LocalStorage(dir);
  store.save({ document: 'original', evidence: ['one'] });
  const bytes = readFileSync(join(dir, 'workspace.enc'));
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.throws(() => store.save(circular), /circular/);
  assert.deepEqual(readFileSync(join(dir, 'workspace.enc')), bytes);
  assert.deepEqual(readdirSync(dir).sort(), ['workspace.enc', 'workspace.key']);
  assert.deepEqual(store.read(), { document: 'original', evidence: ['one'] });
});
