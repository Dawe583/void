import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOperation } from './operations.ts';
import { devKeyProvider } from '../../ledger/src/sign.ts';
import { jsonlStore } from '../../ledger/src/store.ts';
import { verifyAttestation } from '../../ledger/src/attest.ts';
import { readLedgerEntries } from '../../ledger/src/verify.ts';

test('CLI export and attest preserve independently verifiable signed evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'void-beta-operations-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, 'keys'), env: {} });
  const env = { VOID_SIGNING_KEY: (await readFile(join(dir, 'keys/dev-ed25519.pkcs8'))).toString('base64') };
  await jsonlStore(signer, { dir }).append({ workspace: 'beta', at: new Date().toISOString(), tool: 'fixture.echo', klass: 'r0', decision: 'allow', argsDigest: 'a'.repeat(64) });
  const ledger = join(dir, 'beta.jsonl');
  const out: string[] = [];
  assert.equal(await runOperation('export', ['--ledger', ledger], env, text => out.push(text)), 0);
  assert.deepEqual(JSON.parse(out[0]!), (await readLedgerEntries(ledger))[0]);
  out.length = 0;
  assert.equal(await runOperation('attest', ['--ledger', ledger], env, text => out.push(text)), 0);
  assert.deepEqual(await verifyAttestation(JSON.parse(out[0]!), await readLedgerEntries(ledger), { publicKey: id => signer.publicKey(id) }), { ok: true });
  await writeFile(ledger, (await readFile(ledger, 'utf8')).replace('fixture.echo', 'tampered.echo'));
  await assert.rejects(runOperation('export', ['--ledger', ledger], env, () => assert.fail('must not export tampered entries')), /verification failed/);
});
