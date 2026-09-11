import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../apps/control-plane/api/remote-gateway.mjs';

function response() {
  return { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.body = JSON.parse(text); } };
}

test('hosted gateway fails closed, authenticates, scopes requests and hides upstream errors', async t => {
  const token = 'test-only-token-'.repeat(4);
  const previous = { token: process.env.VOID_CONTROL_TOKEN, origin: process.env.VOID_CONTROL_ORIGIN };
  t.after(() => {
    if (previous.token === undefined) delete process.env.VOID_CONTROL_TOKEN; else process.env.VOID_CONTROL_TOKEN = previous.token;
    if (previous.origin === undefined) delete process.env.VOID_CONTROL_ORIGIN; else process.env.VOID_CONTROL_ORIGIN = previous.origin;
  });
  process.env.VOID_CONTROL_TOKEN = token;
  process.env.VOID_CONTROL_ORIGIN = 'https://runtime.example.test';
  const call = async (url, extra = {}) => {
    const res = response();
    await handler({ url, method: 'GET', headers: { host: 'void.example.test' }, ...extra }, res);
    return res;
  };
  assert.equal((await call('/api/feed')).statusCode, 401);
  assert.equal((await call('/api/session', { method: 'POST', headers: { host: 'void.example.test', origin: 'https://evil.test' } })).statusCode, 403);
  const login = await call('/api/session', { method: 'POST', headers: { host: 'void.example.test', 'content-type': 'application/json' }, body: { token } });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly; Secure; SameSite=Strict/);
  assert.match(login.headers['set-cookie'], /Max-Age=34560000$/);
  const headers = { host: 'void.example.test', cookie: `__Host-void-session=${token}` };
  assert.equal((await call('/api/unknown', { headers })).statusCode, 404);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://runtime.example.test/api/feed?workspace=beta');
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => ({ entries: [], integrity: true }) };
  });
  const result = await call('/api/feed?workspace=beta', { headers });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['set-cookie'], login.headers['set-cookie']);
  const logout = await call('/api/session', { method: 'DELETE' });
  assert.match(logout.headers['set-cookie'], /Max-Age=0$/);
  assert.deepEqual(result.body.entries, []);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(token); });
  const unavailable = await call('/api/feed', { headers });
  assert.equal(unavailable.statusCode, 502);
  assert.ok(!JSON.stringify(unavailable.body).includes(token));
});
