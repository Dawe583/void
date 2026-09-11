import { workspaceSessionCookie } from "./session-cookie.mjs";
import { timingSafeEqual } from 'node:crypto';

const sameToken = (value, token) => {
  const left = Buffer.from(value ?? '');
  const right = Buffer.from(token ?? '');
  return right.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
};
const json = (response, status, body) => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
};

/** The Vercel function is a stateless gateway. Durable ledgers and active holds
 * remain with the running proxy; serverless /tmp is never treated as a store. */
export default async function handler(request, response) {
  const token = process.env.VOID_CONTROL_TOKEN;
  const upstream = process.env.VOID_CONTROL_ORIGIN;
  const url = new URL(request.url, 'https://void.invalid');
  if (!token || token.length < 32 || !upstream) return json(response, 503, {
    error: 'setup_required', message: 'Connect your VOID runtime: configure VOID_CONTROL_ORIGIN (HTTPS) and VOID_CONTROL_TOKEN on Vercel. The token must have at least 32 characters.',
  });
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin && origin !== `https://${host}`) return json(response, 403, { error: 'origin_rejected' });
  if (request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'origin_rejected' });
  if (url.pathname === '/api/session' && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'json_required' });
    let body = request.body;
    try {
      if (body === undefined) { let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 4096) return json(response, 413, { error: 'body_too_large' }); } body = JSON.parse(text); }
      if (typeof body === 'string') body = JSON.parse(body);
    } catch { return json(response, 400, { error: 'invalid_json' }); }
    if (!sameToken(body?.token, token)) return json(response, 401, { error: 'invalid_token', message: 'The access token was not accepted.' });
    response.setHeader('set-cookie', workspaceSessionCookie(token));
    return json(response, 200, { ok: true });
  }
  if (url.pathname === '/api/session' && request.method === 'DELETE') {
    response.setHeader('set-cookie', workspaceSessionCookie());
    return json(response, 200, { ok: true });
  }
  let cookie;
  try { cookie = decodeURIComponent(request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('__Host-void-session='))?.split('=').slice(1).join('=') ?? ''); }
  catch { return json(response, 401, { error: 'authentication_required' }); }
  if (!sameToken(cookie, token)) return json(response, 401, { error: 'authentication_required', message: 'Enter your workspace access token to connect.' });
  response.setHeader('set-cookie', workspaceSessionCookie(token));
  const allowed = /^\/api\/(provider|sessions(?:\/[a-f0-9-]+)?|feed|approvals|ledger\/(verify|export)|records\/\d+\/(taint|replay)|approvals\/[^/]+\/decision)$/;
  if (!allowed.test(url.pathname)) return json(response, 404, { error: 'not_found' });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'method_not_allowed' });
  try {
    const target = new URL(upstream);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new Error('invalid upstream');
    target.pathname = url.pathname;
    target.search = url.search;
    let body;
    if (request.method === 'POST') {
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'json_required' });
      if (request.body !== undefined) body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      else { body = ''; for await (const chunk of request) { body += chunk; if (body.length > 65536) return json(response, 413, { error: 'body_too_large' }); } }
      if (body.length > 65536) return json(response, 413, { error: 'body_too_large' });
    }
    const result = await fetch(target, { method: request.method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
    const payload = await result.json();
    return json(response, result.status, payload);
  } catch { return json(response, 502, { error: 'runtime_unavailable', message: 'Your VOID runtime is unreachable. Start the runtime and check its HTTPS address.' }); }
}
