import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesToken, authorizedRemote } from './auth.ts';
import { localApprovals } from './local-approvals.ts';
import { ApprovalBroker } from '../../../packages/policy/src/approvals.ts';
import { HoldQueue } from '../../../packages/policy/src/hold.ts';
import { listenControlPlane } from './server.ts';
import type { IncomingMessage } from 'node:http';

test('remote control refuses absent, short, wrong tokens and browser origins', () => {
  const token = 'a'.repeat(64);
  assert.equal(matchesToken(undefined, token), false);
  assert.equal(matchesToken('short', 'short'), false);
  assert.equal(matchesToken('b'.repeat(64), token), false);
  assert.equal(matchesToken(token, token), true);
  const request = (headers: Record<string, string>) => ({ headers }) as IncomingMessage;
  assert.equal(authorizedRemote(request({ authorization: `Bearer ${token}` }), { VOID_CONTROL_TOKEN: token }), true);
  assert.equal(authorizedRemote(request({ authorization: `Bearer ${token}`, origin: 'https://evil.test' }), { VOID_CONTROL_TOKEN: token }), false);
});

test('standalone HTTP decision reaches the proxy broker through durable state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'void-beta-approvals-'));
  const broker = new ApprovalBroker({ stateDir: dir });
  const queue = new HoldQueue();
  const call = { tool: 'postgres.row.delete', klass: 'r3' as const, workspace: 'default', connector: 'postgres', blastRadius: undefined };
  const waiting = queue.hold({ ...call, blastRadius: undefined, ruleIndex: 0, rationale: 'beta fixture', args: {}, notify: ['cli'] }, 10);
  const hold = broker.register(queue, call);
  const server = await listenControlPlane({ env: {}, approvals: localApprovals({ VOID_APPROVALS_DIR: dir }) });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const pending = await (await fetch(`${origin}/api/approvals`)).json() as { approvals: unknown[] };
    assert.equal(pending.approvals.length, 1);
    assert.doesNotMatch(JSON.stringify(pending), /decisionToken/);
    const response = await fetch(`${origin}/api/approvals/${hold.holdId}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'denied', by: 'beta-test' }) });
    assert.deepEqual(await response.json(), { ok: true, result: { queued: true } });
    assert.equal(queue.list().length, 1);
    broker.consumeDecisions();
    const result = await waiting;
    assert.deepEqual(result.outcome, { kind: 'released', release: { kind: 'denied', by: 'beta-test' } });
    assert.equal(queue.list().length, 0);
  } finally { await server.close(); broker.close(); await rm(dir, { recursive: true, force: true }); }
});
