import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync, lstatSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { reservedRecoveryVault } from '../../runtime/src/index.ts';

// One atomic encrypted snapshot commits managed files and their signed history
// together. A failed write cannot expose a changed document without its inverse.
export class LocalStorage {
  private readonly key: Buffer;
  private revision: string | undefined;
  private readonly path: string;
  readonly directory: string;
  recoveryVault() { return reservedRecoveryVault(join(this.directory,'recovery','vault'),{workspace:this.key},'workspace',{maxArtifactBytes:4*1024*1024,maxTotalBytes:1024*1024*1024}); }
  constructor(directory: string, externalKey?: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, 'workspace.key');
    if (externalKey) this.key = Buffer.from(externalKey, "base64");
    else try { this.key = readFileSync(keyPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      try { writeFileSync(keyPath, this.key, { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; this.key = readFileSync(keyPath); }
    }
    if (this.key.length !== 32) throw new Error('Invalid workspace encryption key.');
    this.path = join(directory, 'workspace.enc');
  }
  read<T>(): T | undefined {
    let data: Buffer;
    try { data = readFileSync(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    this.revision = createHash('sha256').update(data).digest('hex');
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString()) as T;
  }
  save(value: unknown): void {
    const lock = `${this.path}.lock`;
    const owner = acquireLock(lock);
    try {
      let current: string | undefined;
      try { current = createHash('sha256').update(readFileSync(this.path)).digest('hex'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (current !== this.revision) throw new Error('Workspace changed in another runtime. Restart this app before writing.');
      this.commit(value);
    } finally {
      // Never release a replacement lock belonging to another process.
      try { if (sameFile(owner, lstatSync(lock)) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  private commit(value: unknown): void {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}`;
    writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), bytes]), { mode: 0o600, flag: 'wx' });
    const fd = openSync(temporary, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path);
    this.revision = createHash("sha256").update(readFileSync(this.path)).digest("hex");
    const dir = openSync(this.directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}

function acquireLock(path: string): Stats {
  try { writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const original = lstatSync(path);
    if (!original.isFile()) throw new Error('Workspace lock has an unknown owner. Refusing to replace it.');
    const text = readFileSync(path, 'utf8');
    const pid = /^[1-9][0-9]{0,9}$/.test(text) ? Number(text) : 0;
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new Error('Workspace lock has an unknown owner. Refusing to replace it.');
    let gone = false;
    try { process.kill(pid, 0); }
    catch (ownerError) { gone = (ownerError as NodeJS.ErrnoException).code === 'ESRCH'; }
    if (!gone) throw new Error('Workspace is locked by another live or inaccessible process.');
    // A process exit proves staleness, but a concurrent recovery may have
    // already installed a new lock. Match its identity and contents again.
    if (!sameFile(original, lstatSync(path)) || readFileSync(path, 'utf8') !== text) throw new Error('Workspace lock changed during recovery. Retry after the other runtime finishes.');
    unlinkSync(path);
    writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 });
  }
  return lstatSync(path);
}
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
