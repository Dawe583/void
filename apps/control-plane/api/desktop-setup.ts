/** Import fixed local credential sources only. Configuration is data, never code. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PROVIDER_PRESETS } from '../../../packages/workbench/src/provider-defaults.ts';
import type { Workbench } from '../../../packages/workbench/src/index.ts';

const sources = [
  { id: 'prime:tokenrouter', name: 'TokenRouter', source: 'Prime', file: '.prime/agent/models.json', provider: 'tokenrouter', entry: 'tokenrouter', models: true },
  { id: 'opencode:zen', name: 'OpenCode Zen', source: 'OpenCode', file: '.local/share/opencode/auth.json', provider: 'opencode-zen', entry: 'opencode' },
  { id: 'prime:zen', name: 'OpenCode Zen', source: 'Prime', file: '.prime/agent/auth.json', provider: 'opencode-zen', entry: 'opencode' },
  { id: 'opencode:openrouter', name: 'OpenRouter', source: 'OpenCode', file: '.local/share/opencode/auth.json', provider: 'openrouter', entry: 'openrouter' },
  { id: 'prime:openrouter', name: 'OpenRouter', source: 'Prime', file: '.prime/agent/auth.json', provider: 'openrouter', entry: 'openrouter' },
] as const;

type Source = typeof sources[number];
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}
async function credential(source: Source, env: Readonly<NodeJS.ProcessEnv>) {
  const home = env.HOME ?? homedir();
  if (!isAbsolute(home)) throw new Error('unavailable');
  const file = await open(join(home, source.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error('unavailable');
    // Bound the read as well as the stat, since another process may grow the file.
    const buffer = Buffer.alloc(1_048_577);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 1_048_576) throw new Error('unavailable');
    const data = object(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    const preset = PROVIDER_PRESETS.find(p => p.id === source.provider)!;
    let key: unknown;
    if ('models' in source) {
      const entry = object(object(data.providers)[source.entry]);
      if (entry.baseUrl !== preset.baseUrl) throw new Error('unavailable');
      key = entry.apiKey;
    } else {
      const entry = object(data[source.entry]);
      if (entry.type !== (source.source === 'Prime' ? 'api_key' : 'api')) throw new Error('unavailable');
      key = entry.key;
    }
    if (typeof key !== 'string' || !key.length || key.length > 8192 || /\s|\$\{|^!|^\{env:|^\{file:/.test(key)) throw new Error('unavailable');
    return { baseUrl: preset.baseUrl, kind: preset.kind, apiKey: key };
  } finally { await file.close(); }
}

export async function desktopSetup(env: Readonly<NodeJS.ProcessEnv>) {
  return {
    sources: await Promise.all(sources.map(async source => {
      let available = false;
      try { await credential(source, env); available = true; } catch { /* No paths or credentials in public diagnostics. */ }
      return { id: source.id, name: source.name, source: source.source, available };
    })),
    localDocuments: true,
    externalToolUndo: false,
  };
}

export async function importDesktopProvider(id: unknown, env: Readonly<NodeJS.ProcessEnv>, workbench: Workbench) {
  const source = sources.find(source => source.id === id);
  if (!source) throw new Error('Unsupported provider import.');
  let config;
  try { config = await credential(source, env); }
  catch { throw new Error('Local API key unavailable. OAuth, command references and custom endpoints cannot be imported.'); }
  // Validation talks only to the fixed provider endpoint, never a URL from disk.
  try { await workbench.configure(config); }
  catch { throw new Error('Provider validation or local save failed. Check the provider and reopen VOID before retrying.'); }
  return workbench.providerState();
}
