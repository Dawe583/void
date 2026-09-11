import test from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const desktop = fileURLToPath(new URL('./', import.meta.url));
const web = fileURLToPath(new URL('../control-plane/web/', import.meta.url));

test('desktop runtime serves the shared workbench, rejects foreign origins, and stops with its owner', { timeout: 20000 }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'void-desktop-'));
  const packaged = process.env.VOID_TEST_PACKAGED === '1';
  const executable = packaged ? join(desktop, 'src-tauri/resources/bin/node') : process.execPath;
  const entry = packaged ? join(desktop, 'src-tauri/resources/runtime/runtime.mjs') : join(desktop, 'runtime.mjs');
  const env = { ...process.env, VOID_DATA_DIR: data, VOID_DESKTOP_WEB_ROOT: web, VOID_CONTROL_TOKEN: 'ignored-cloud-token'.repeat(4), VOID_WORKSPACE_KEY: randomBytes(32).toString('base64') };
  for (const key of ['OPENROUTER_API_KEY', 'VOID_PROVIDER_URL', 'VOID_UPSTREAM_COMMAND', 'VOID_POLICY_PATH', 'VOID_LEDGER_DIR', 'VOID_SIGNING_KEY', 'VOID_VERIFY_KEY']) delete env[key];
  const child = spawn(executable, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  try {
    const [line] = await Promise.race([once(lines, 'line'), exited.then(() => { throw new Error(`Runtime startup failed: ${errors}`); })]);
    const ready = JSON.parse(line);
    const origin = `http://127.0.0.1:${ready.port}`;
    assert.equal(ready.pid, child.pid);
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /VOID/);
    const state = await fetch(`${origin}/api/provider`);
    assert.equal(state.status, 200);
    assert.equal((await state.json()).connected, false);
    await assert.rejects(access(join(data, 'workspace.key')), { code: 'ENOENT' });
    const foreign = await fetch(`${origin}/api/provider`, { headers: { origin: 'https://attacker.invalid' } });
    assert.equal(foreign.status, 403);
    if (process.platform !== 'win32') assert.equal((await stat(data)).mode & 0o777, 0o700);
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0, errors);
    await assert.rejects(fetch(origin));
  } finally {
    child.kill('SIGKILL');
    lines.close();
    await rm(data, { recursive: true, force: true });
  }
});
