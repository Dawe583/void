// Disposable browser QA: a clearly labeled model fixture drives the real VOID
// SDK, proxy, policy, ledger, HTTP API and UI. No external provider is contacted.
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devKeyProvider } from '../../packages/ledger/src/sign.ts';
import { createControlPlaneServer } from '../../apps/control-plane/api/server.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'void-beta-preview-'));
await devKeyProvider({ dir: join(temp, 'keys'), env: {} });
process.env.VOID_SIGNING_KEY = (await readFile(join(temp, 'keys/dev-ed25519.pkcs8'))).toString('base64');
const model = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'illustrative-local-fixture', name: 'Illustrative local fixture (no external AI)' }] }));
  let body = ''; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  const last = input.messages.at(-1);
  if (last.role === 'tool') return response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Illustrative QA session complete. The tool result returned through VOID. Inspect the signed ledger for the actual decision.' } }], usage: { total_tokens: 0 } }));
  const destructive = last.content.toLowerCase().includes('delete');
  const tool = input.tools.find(item => item.function.description.startsWith(destructive ? 'orders_delete:' : 'echo:'));
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Illustrative QA fixture: requesting the configured test tool.', tool_calls: [{ id: `fixture-${Date.now()}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(destructive ? { where: 'status = stale' } : { text: last.content }) } }] } }] }));
});
await new Promise(resolve => model.listen(8083, '127.0.0.1', resolve));
const app = createControlPlaneServer({ env: { ...process.env, VOID_LEDGER_DIR: temp, VOID_UPSTREAM_COMMAND: JSON.stringify([process.execPath, join(root, 'fixtures/e2e-server.mjs')]), VOID_POLICY_PATH: join(root, 'fixtures/e2e-policy.yaml'), VOID_PROVIDER_URL: 'http://127.0.0.1:8083/v1', OPENROUTER_API_KEY: 'illustrative-fixture-key' } });
app.listen(8082, '127.0.0.1', () => console.log('Illustrative beta QA: http://127.0.0.1:8082'));
async function stop() { app.close(); model.close(); await rm(temp, { recursive: true, force: true }); }
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
