import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { attestLedger } from '../../ledger/src/attest.ts';
import { devKeyProvider } from '../../ledger/src/sign.ts';
import { readLedgerEntries, verifyChain } from '../../ledger/src/verify.ts';
import { listPacks, loadPack } from '../../policy/src/packs.ts';
import { loadPolicy } from '../../policy/src/rules.ts';

export async function runOperation(command: string, argv: readonly string[], env: Readonly<NodeJS.ProcessEnv>, output: (text: string) => void): Promise<number> {
  if (command === 'policy') {
    if (argv.length === 0 || (argv.length === 1 && argv[0] === 'list')) { output(listPacks().join('\n')); return 0; }
    if (argv.length === 2 && argv[0] === 'show') { output(JSON.stringify(await loadPack(argv[1]!), null, 2)); return 0; }
    if (argv.length === 2 && argv[0] === 'validate') {
      const result = loadPolicy(await readFile(argv[1]!, 'utf8'));
      if (!result.ok) throw new Error('Policy is invalid; fix its structure before starting the proxy.');
      output('Policy valid'); return 0;
    }
    throw new Error('usage: void policy list | show <strict|balanced|dev> | validate <file>');
  }
  let workspace = env.VOID_WORKSPACE ?? 'default';
  let ledger: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg !== '--ledger' && arg !== '--workspace') throw new Error(`unknown ${command} option`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    if (arg === '--ledger') ledger = value; else workspace = value;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(workspace)) throw new Error('invalid workspace');
  ledger ??= join(env.VOID_LEDGER_DIR ?? join(homedir(), '.void', 'ledger'), `${workspace}.jsonl`);
  if ((await stat(ledger)).isDirectory()) ledger = join(ledger, `${workspace}.jsonl`);
  workspace = basename(ledger, '.jsonl');
  const signer = await devKeyProvider({ env });
  const entries = await readLedgerEntries(ledger);
  const result = await verifyChain(entries, { publicKey: id => signer.publicKey(id) });
  if (!result.ok) throw new Error('Ledger verification failed; export and attestation refused.');
  if (command === 'attest') output(JSON.stringify(await attestLedger(dirname(ledger), workspace, signer), null, 2));
  else if (command === 'export') output(entries.map(entry => JSON.stringify(entry)).join('\n'));
  else throw new Error('unknown operation');
  return 0;
}
