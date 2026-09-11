import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Workbench } from './index.ts';
import { CompatibleProvider } from './provider.ts';
import { readLedgerFeed } from '../../ledger/src/feed.ts';

const secret = 'fixture-provider-secret';
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('provider validates transport and never echoes upstream error bodies', async () => {
  assert.throws(() => new CompatibleProvider({ baseUrl: 'http://remote.test/v1', apiKey: secret }), /HTTPS/);
  const provider = new CompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: secret }, async () => new Response(secret, { status: 401 }));
  await assert.rejects(provider.models(), error => error instanceof Error && !error.message.includes(secret) && error.message.includes('401'));
});

test('model tool calls cross a real VOID proxy and produce a ledger', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'void-agent-beta-'));
  let turn = 0;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal((options?.headers as Record<string, string>).authorization, `Bearer ${secret}`);
    if (String(url).endsWith('/models')) return reply({ data: [{ id: 'fixture-model' }] });
    const request = JSON.parse(String(options?.body));
    turn++;
    if (turn === 1) {
      const tool = request.tools.find((item: { function: { description: string } }) => item.function.description.startsWith('echo:'));
      const document = request.tools.find((item: { function: { description: string } }) => item.function.description.startsWith('void_workspace_write:'));
      return reply({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'document1', type: 'function', function: { name: document.function.name, arguments: JSON.stringify({ path: 'mixed.md', content: 'Managed and stdio in one session.' }) } }, { id: 'call1', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ text: 'fixture echo' }) } }] } }] });
    }
    assert.equal(request.messages.at(-1).role, 'tool');
    return reply({ choices: [{ message: { role: 'assistant', content: `Finished ${secret}` } }], usage: { total_tokens: 23 } });
  };
  const workbench = new Workbench({ VOID_LEDGER_DIR: dir, VOID_UPSTREAM_COMMAND: JSON.stringify([process.execPath, join(root, 'fixtures/e2e-server.mjs')]), VOID_POLICY_PATH: join(root, 'fixtures/e2e-policy.yaml') }, fetcher);
  t.after(async () => { workbench.close(); await rm(dir, { recursive: true, force: true }); });
  await workbench.configure({ baseUrl: 'https://provider.test/v1', apiKey: secret });
  const started = await workbench.start('Test echo', 'fixture-model');
  for (let i = 0; i < 200 && workbench.get(started.id)?.status === 'running'; i++) await delay(20);
  const session = workbench.get(started.id)!;
  assert.equal(session.status, 'idle', JSON.stringify(session.events));
  assert.equal(turn, 2);
  assert.ok(!JSON.stringify(session).includes(secret));
  const feed = await readLedgerFeed(join(dir, `${started.workspace}.jsonl`));
  assert.ok(feed.records.some(record => record.tool === 'echo' && record.decision.startsWith('allow')));
  const managed = await workbench.ledger(started.workspace);
  assert.ok(managed?.entries.some(e => (e.body as {tool:string}).tool === 'void_workspace_write'));
  assert.ok(managed?.entries.some(e => { const b = e.body as {tool:string;source?:string;klass:string}; return b.tool === 'echo' && b.source === 'stdio-proxy' && b.klass === feed.records.find(r => r.tool === 'echo')?.klass; }));
  workbench.cancel(started.id);
  assert.equal(workbench.get(started.id)?.status, 'cancelled');
});

test('a destructive model call waits for an operator in its own workspace', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'void-agent-hold-'));
  let turn = 0;
  const workbench = new Workbench({ VOID_LEDGER_DIR: dir, VOID_UPSTREAM_COMMAND: JSON.stringify([process.execPath, join(root, 'fixtures/e2e-server.mjs')]), VOID_POLICY_PATH: join(root, 'fixtures/e2e-policy.yaml') }, async (url, options) => {
    if (String(url).endsWith('/models')) return reply({ data: [{ id: 'fixture-model' }] });
    if (++turn > 1) return reply({ choices: [{ message: { role: 'assistant', content: 'Operator decision received.' } }] });
    const request = JSON.parse(String(options?.body));
    const tool = request.tools.find((item: { function: { description: string } }) => item.function.description.startsWith('orders_delete:'));
    return reply({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'held', type: 'function', function: { name: tool.function.name, arguments: '{"where":"id = 1"}' } }] } }] });
  });
  t.after(async () => { workbench.close(); await rm(dir, { recursive: true, force: true }); });
  await workbench.configure({ baseUrl: 'https://provider.test/v1', apiKey: secret });
  const session = await workbench.start('Request a destructive fixture', 'fixture-model');
  for (let i = 0; i < 100 && !workbench.pending().length; i++) await delay(20);
  const hold = workbench.pending()[0]!;
  assert.ok(hold);
  assert.equal(hold.call.workspace, session.workspace);
  assert.equal(turn, 1, 'model must wait on VOID approval');
  assert.equal(workbench.decide(hold.holdId, { kind: 'denied', by: 'beta-test' }), true);
  for (let i = 0; i < 100 && workbench.get(session.id)?.status === 'running'; i++) await delay(20);
  assert.equal(workbench.get(session.id)?.status, 'idle');
  const feed = await readLedgerFeed(join(dir, `${session.workspace}.jsonl`));
  assert.ok(feed.records.some(record => record.decision === 'hold:denied'));
});

test('long sessions keep advancing event cursors and refuse unbounded context', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'void-agent-context-'));
  const fetcher: typeof fetch = async url => String(url).endsWith('/models')
    ? reply({ data: [{ id: 'fixture-model' }] })
    : reply({ choices: [{ message: { role: 'assistant', content: 'Fixture response' } }], usage: { total_tokens: 1 } });
  const workbench = new Workbench({ VOID_LEDGER_DIR: dir, VOID_UPSTREAM_COMMAND: JSON.stringify([process.execPath, join(root, 'fixtures/e2e-server.mjs')]), VOID_POLICY_PATH: join(root, 'fixtures/e2e-policy.yaml') }, fetcher);
  t.after(async () => { workbench.close(); await rm(dir, { recursive: true, force: true }); });
  await workbench.configure({ baseUrl: 'https://provider.test/v1', apiKey: secret });
  const started = await workbench.start('First', 'fixture-model');
  for (let turn = 0; turn < 99; turn++) {
    for (let poll = 0; poll < 200 && workbench.get(started.id)?.status === 'running'; poll++) await delay(10);
    assert.equal(workbench.get(started.id)?.status, 'idle');
    if (turn < 98) workbench.send(started.id, `Follow up ${turn}`);
  }
  const events = workbench.get(started.id)!.events;
  assert.equal(events.length, 200);
  assert.ok(events.at(-1)!.seq > 200);
  assert.throws(() => workbench.send(started.id, 'Too much context'), /context limit/);
});

test('chat catalog excludes embedding, image and video models', async () => {
  const provider = new CompatibleProvider({baseUrl:'https://provider.test/v1',apiKey:secret}, async () => reply({data:[{id:'chat',type:'language'},{id:'embed',type:'embedding'},{id:'video',type:'video'},{id:'image',type:'image'},{id:'compatible-provider-model'}]}));
  assert.deepEqual((await provider.models()).map(model=>model.id),['chat','compatible-provider-model']);
});
