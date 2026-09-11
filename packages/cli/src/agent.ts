import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Workbench } from '../../workbench/src/index.ts';
import { sanitizeText } from './tui/layout.ts';

export async function runAgentCommand(argv: readonly string[]): Promise<number> {
  let model = process.env.VOID_MODEL;
  let prompt: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; const value = argv[++i];
    if (!value || !['--model', '--prompt'].includes(arg ?? '')) throw new Error('usage: void agent --model <id> [--prompt <task>]');
    if (arg === '--model') model = value; else prompt = value;
  }
  if (!model) throw new Error('Select a model with --model or VOID_MODEL.');
  const workbench = new Workbench();
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const input = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  let cancelled = false;
  const stop = () => { cancelled = true; workbench.close(); input?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const provider = await workbench.providerState();
    if (!provider.connected) throw new Error('Set OPENROUTER_API_KEY and optional VOID_PROVIDER_URL on the runtime.');
    prompt ??= await input?.question('[v] Task > ');
    if (!prompt) throw new Error('A piped session requires --prompt.');
    const started = await workbench.start(prompt, model);
    process.stdout.write(`[v] VOID / ${started.workspace}\n# intent -> # classify -> # decide -> . seal\n`);
    let shown = 0;
    const decided = new Set<string>();
    while (!cancelled) {
      const session = workbench.get(started.id)!;
      for (const event of session.events.filter(event => event.seq > shown)) process.stdout.write(`[${event.kind}] ${sanitizeText(event.text)}\n`);
      shown = session.events.at(-1)?.seq ?? shown;
      const holds = workbench.pending();
      for (const hold of holds) {
        if (decided.has(hold.holdId)) continue;
        decided.add(hold.holdId);
        process.stdout.write(`[!] ${sanitizeText(hold.call.tool)} ${hold.call.klass} / radius ${hold.call.blastRadius ?? 'unknown'}\n`);
        if (!input) { workbench.decide(hold.holdId, { kind: 'denied', by: 'noninteractive-agent' }); process.stdout.write('[x] No interactive approver: denied.\n'); continue; }
        const key = await input.question('[!] Approve this held tool call? Type yes, or press Enter to deny > ');
        workbench.decide(hold.holdId, { kind: key === 'yes' ? 'approved' : 'denied', by: 'agent-tui' });
      }
      if (session.status === 'failed') return 1;
      if (session.status === 'cancelled') return 0;
      if (session.status === 'idle') {
        if (!input) return 0;
        const next = await input.question('[v] Message (blank to finish) > ');
        if (!next.trim()) return 0;
        workbench.send(started.id, next);
      }
      await delay(200);
    }
    return 0;
  } finally { stop(); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
