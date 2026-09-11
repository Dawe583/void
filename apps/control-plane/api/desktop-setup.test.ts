import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { desktopSetup, importDesktopProvider } from './desktop-setup.ts';
import { listenControlPlane } from './server.ts';
import { Workbench } from '../../../packages/workbench/src/index.ts';

async function fixture(t: TestContext, fetcher: typeof fetch = async () => Response.json({ data: [{ id: 'muse-spark-1.3-contributor-free' }] })) {
  const home = await mkdtemp(join(tmpdir(), 'void-setup-'));
  const env = { HOME: home, VOID_DATA_DIR: join(home, 'void'), VOID_DESKTOP_WEB_ROOT: home };
  const app = new Workbench(env, fetcher);
  t.after(async () => {
    try { app.close(); } catch (error) { assert.match(String(error), /Workspace changed in another runtime/); }
    finally { await rm(home, { recursive: true, force: true }); }
  });
  async function save(file: string, data: unknown) {
    const path = join(home, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
    return path;
  }
  return { home, env, app, save };
}
const auth = '.local/share/opencode/auth.json';
const key = 'fixture-private-key-never-expose';

test('local import uses fixed endpoint, hides key, selects valid model and survives restart encrypted', async t => {
  let calls = 0;
  const f = await fixture(t, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://opencode.ai/zen/v1/models');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
    assert.equal(init?.redirect, 'error');
    return Response.json({ data: [{ id: 'zen-test-model' }] });
  });
  const file = await f.save(auth, { opencode: { type: 'api', key } });
  const original = await readFile(file);
  const scan = await desktopSetup(f.env);
  assert.equal(scan.sources.find(s => s.id === 'opencode:zen')?.available, true);
  assert.equal(calls, 0, 'Discovery must not contact providers');
  assert.ok(!JSON.stringify(scan).includes(key));
  const result = await importDesktopProvider('opencode:zen', f.env, f.app);
  assert.equal(calls, 1);
  assert.equal(result.defaultModel, 'zen-test-model');
  assert.ok(!JSON.stringify(result).includes(key));
  assert.deepEqual(await readFile(file), original);
  const restored = new Workbench(f.env);
  try { assert.equal((await restored.providerState()).defaultModel, 'zen-test-model'); }
  finally { restored.close(); }
  assert.ok(!(await readFile(join(f.env.VOID_DATA_DIR, 'workspace.enc'))).includes(Buffer.from(key)));
});

test('Prime TokenRouter import keeps requested GLM when available', async t => {
  const f = await fixture(t, async () => Response.json({ data: [{ id: 'other' }, { id: 'z-ai/glm-5.3-free' }] }));
  await f.save('.prime/agent/models.json', { providers: { tokenrouter: { baseUrl: 'https://api.tokenrouter.com/v1', apiKey: key } } });
  const result = await importDesktopProvider('prime:tokenrouter', f.env, f.app);
  assert.equal(result.defaultModel, 'z-ai/glm-5.3-free');
  assert.equal(result.providerId, 'tokenrouter');
});

test('unsupported, malformed, OAuth and command credentials never dispatch', async t => {
  const f = await fixture(t, async () => { assert.fail('Must not send credentials'); });
  for (const input of ['{broken', { opencode: { type: 'oauth', access: key } }, { opencode: { type: 'api', key: '!touch /tmp/not-allowed' } }, { opencode: { type: 'api', key: '${SECRET}' } }, { opencode: { type: 'api', key: '' } }]) {
    await f.save(auth, input);
    assert.equal((await desktopSetup(f.env)).sources.find(s => s.id === 'opencode:zen')?.available, false);
    await assert.rejects(importDesktopProvider('opencode:zen', f.env, f.app), /unavailable/);
  }
  await assert.rejects(importDesktopProvider('../../secrets', f.env, f.app), /Unsupported/);
  await assert.rejects(importDesktopProvider(null, f.env, f.app), /Unsupported/);
});

test('custom credential destinations, oversized files and symlinks fail closed', async t => {
  const f = await fixture(t, async () => { assert.fail('Must not send credentials'); });
  await f.save('.prime/agent/models.json', { providers: { tokenrouter: { baseUrl: 'https://attacker.invalid', apiKey: key } } });
  await assert.rejects(importDesktopProvider('prime:tokenrouter', f.env, f.app), /unavailable/);
  const path = await f.save(auth, ' '.repeat(1_048_577));
  await assert.rejects(importDesktopProvider('opencode:zen', f.env, f.app), /unavailable/);
  await rm(path);
  const target = await f.save('secret.json', { opencode: { type: 'api', key } });
  await symlink(target, path);
  await assert.rejects(importDesktopProvider('opencode:zen', f.env, f.app), /unavailable/);
});

test('rejected credential, empty catalog and network failure keep previous provider', async t => {
  let mode = 'ok';
  const f = await fixture(t, async () => {
    if (mode === 'throw') throw new Error(key);
    return mode === 'denied' ? new Response(key, { status: 401 }) : Response.json({ data: mode === 'empty' ? [] : [{ id: 'prior-model' }] });
  });
  await f.app.configure({ baseUrl: 'https://provider.test/v1', apiKey: 'prior' });
  const before = await f.app.providerState();
  await f.save(auth, { opencode: { type: 'api', key } });
  for (mode of ['denied', 'empty', 'throw']) {
    await assert.rejects(importDesktopProvider('opencode:zen', f.env, f.app), error => {
      assert.ok(error instanceof Error && !error.message.includes(key)); return true;
    });
    assert.deepEqual(await f.app.providerState(), before);
  }
});

test('concurrent workspace writer prevents import and retains prior in-memory provider', async t => {
  const f = await fixture(t);
  await f.app.configure({ baseUrl: 'https://prior.test/v1', apiKey: 'prior' });
  const before = await f.app.providerState();
  const second = new Workbench(f.env, async () => Response.json({ data: [{ id: 'second' }] }));
  try {
    await second.configure({ baseUrl: 'https://second.test/v1', apiKey: 'second' });
    await f.save(auth, { opencode: { type: 'api', key } });
    await assert.rejects(importDesktopProvider('opencode:zen', f.env, f.app), /save failed/);
    assert.deepEqual(await f.app.providerState(), before);
    const restored = new Workbench(f.env);
    try { assert.equal((await restored.providerState()).baseUrl, 'https://second.test/v1'); }
    finally { restored.close(); }
  } finally { assert.throws(() => second.close(), /Workspace changed in another runtime/); }
});

test('desktop API blocks remote mode and hostile origins and rejects extra import parameters', async t => {
  const f = await fixture(t);
  await f.save(auth, { opencode: { type: 'api', key } });
  for (const mode of ['desktop', 'plain', 'remote']) {
    const env = { ...f.env, VOID_DATA_DIR: join(f.home, mode), ...(mode === 'plain' ? { VOID_DESKTOP_WEB_ROOT: '' } : {}), ...(mode === 'remote' ? { VOID_CONTROL_TOKEN: 'a'.repeat(64) } : {}) };
    const server = await listenControlPlane({ env });
    try {
      const url = `http://127.0.0.1:${server.port}/api/desktop/setup`;
      const headers = mode === 'remote' ? { authorization: `Bearer ${env.VOID_CONTROL_TOKEN}` } : {};
      const response = await fetch(url, { headers });
      assert.equal(response.status, mode === 'desktop' ? 200 : 404);
      assert.ok(!(await response.text()).includes(key));
      if (mode === 'desktop') {
        assert.equal((await fetch(url, { headers: { origin: 'https://evil.test' } })).status, 403);
        assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 400);
        assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'opencode:zen', baseUrl: 'https://evil.test' }) })).status, 400);
        assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
      }
    } finally { await server.close(); }
  }
});
