// A disposable, explicitly labeled provider fixture for browser interaction QA.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlPlaneServer } from '../../apps/control-plane/api/server.ts';
const directory = await mkdtemp(join(tmpdir(), 'void-workspace-preview-'));
const model = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'qa-fixture', name: 'QA fixture (not a live model)' }] }));
  let raw = ''; for await (const part of req) raw += part;
  const input = JSON.parse(raw), last = input.messages.at(-1);
  const tool = input.tools.find(t => t.function.description.startsWith('void_workspace_write:'));
  const message = last.role === 'tool' ? { role: 'assistant', content: 'QA fixture: plan.md was written through the real VOID document tool. Open Documents & Undo to review the captured change.' }
    : { role: 'assistant', content: 'QA fixture: creating a project plan with captured history.', tool_calls: [{ id: `qa-${Date.now()}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ path: 'plan.md', content: '# Project plan\n\n1. Define the scope.\n2. Build the smallest useful version.\n3. Verify every write and its inverse.\n' }) } }] };
  res.end(JSON.stringify({ choices: [{ message }] }));
});
await new Promise(resolve => model.listen(8083, '127.0.0.1', resolve));
const app = createControlPlaneServer({ env: { VOID_DATA_DIR: directory, VOID_LEDGER_DIR: join(directory, 'ledger'), OPENROUTER_API_KEY: 'qa-fixture-key', VOID_PROVIDER_URL: 'http://127.0.0.1:8083/v1' } });
app.listen(8082, '127.0.0.1', () => console.log('Disposable workspace QA: http://127.0.0.1:8082'));
async function close() { await new Promise(resolve => app.close(resolve)); await new Promise(resolve => model.close(resolve)); await rm(directory, { recursive: true, force: true }); }
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
