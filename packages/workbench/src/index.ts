import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createVoidClient, type VoidClient } from '../../sdk/src/client.ts';
import { CompatibleProvider, type Model, type ModelMessage, type ProviderConfig } from './provider.ts';
import type { JsonObject } from '../../proxy/src/rpc.ts';

export type SessionEvent = { readonly seq: number; readonly at: string; readonly kind: 'user' | 'assistant' | 'tool' | 'error' | 'usage'; readonly text: string };
export type SessionView = { readonly id: string; readonly workspace: string; readonly model: string; readonly status: 'running' | 'idle' | 'cancelled' | 'failed'; readonly events: readonly SessionEvent[] };
type Session = { view: SessionView; messages: ModelMessage[]; client: VoidClient; controller: AbortController; provider: CompatibleProvider };

/** Model tools always cross the existing VOID SDK. A provider has no shell or
 * filesystem authority; operators configure the MCP upstream on the runtime. */
export class Workbench {
  private readonly env: Readonly<NodeJS.ProcessEnv>;
  private provider: CompatibleProvider | undefined;
  private ignoreEnvironment = false;
  private catalog: readonly Model[] = [];
  private readonly sessions = new Map<string, Session>();
  private readonly fetcher: typeof fetch;
  constructor(env: Readonly<NodeJS.ProcessEnv> = process.env, fetcher: typeof fetch = fetch) { this.env = env; this.fetcher = fetcher; }
  async configure(config: ProviderConfig): Promise<readonly Model[]> {
    const provider = new CompatibleProvider(config, this.fetcher);
    const models = await provider.models();
    this.provider = provider; this.catalog = models;
    return models;
  }
  async providerState() {
    if (!this.provider && !this.ignoreEnvironment && this.env.OPENROUTER_API_KEY) await this.configure({ baseUrl: this.env.VOID_PROVIDER_URL ?? 'https://openrouter.ai/api/v1', apiKey: this.env.OPENROUTER_API_KEY });
    return { connected: this.provider !== undefined, models: this.catalog, keyStorage: 'runtime-memory', upstreamConfigured: this.env.VOID_UPSTREAM_COMMAND !== undefined };
  }
  clearProvider(): void { this.ignoreEnvironment = true; this.provider = undefined; this.catalog = []; }
  list(): readonly SessionView[] { return [...this.sessions.values()].map(session => ({ ...session.view, events: [] })); }
  get(id: string): SessionView | undefined { return this.sessions.get(id)?.view; }
  async start(prompt: string, model: string): Promise<SessionView> {
    if (!this.provider) throw new Error('Connect and validate a provider first.');
    if (!this.catalog.some(item => item.id === model)) throw new Error('Select a model from the validated catalog.');
    if ([...this.sessions.values()].some(session => session.view.status === 'running')) throw new Error('Wait for the active session or cancel it before starting another.');
    let command: unknown;
    try { command = JSON.parse(this.env.VOID_UPSTREAM_COMMAND ?? 'null'); } catch { throw new Error('VOID_UPSTREAM_COMMAND must be a JSON array.'); }
    if (!Array.isArray(command) || !command.length || !command.every(item => typeof item === 'string' && item.length > 0)) throw new Error('Configure VOID_UPSTREAM_COMMAND on the runtime with the MCP server command as a JSON array.');
    if (!this.env.VOID_POLICY_PATH) throw new Error('Configure VOID_POLICY_PATH before starting an agent.');
    if (!prompt.trim() || prompt.length > 32000) throw new Error('Enter a prompt between 1 and 32000 characters.');
    if (this.sessions.size >= 100) throw new Error('Session capacity reached. Restart the runtime after exporting the ledgers.');
    const id = randomUUID();
    const workspace = `agent-${id}`;
    const client = createVoidClient({ workspace, ledgerDir: this.env.VOID_LEDGER_DIR ?? join(homedir(), '.void', 'ledger'), connect: { upstreamCommand: command }, policyPath: this.env.VOID_POLICY_PATH, factsPath: this.env.VOID_FACTS_PATH, posture: 'fail-closed', requestTimeoutMs: 180000 });
    const session: Session = { view: { id, workspace, model, status: 'idle', events: [] }, messages: [{ role: 'system', content: 'You are operating through VOID. Tool calls are classified, governed by policy, and recorded. Respect denied calls; do not retry them with reworded arguments. Wait for operator approval of held calls. Only claim completed actions when tool results prove them.' }], client, controller: new AbortController(), provider: this.provider };
    this.sessions.set(id, session);
    this.send(id, prompt);
    return session.view;
  }
  send(id: string, prompt: string): void {
    const session = this.sessions.get(id);
    if (!session || session.view.status !== 'idle') throw new Error('The session is not ready for another message.');
    if (!prompt.trim() || prompt.length > 32000) throw new Error('Enter a prompt between 1 and 32000 characters.');
    if ([...this.sessions.values()].some(other => other !== session && other.view.status === 'running')) throw new Error('Wait for the active session or cancel it first.');
    if (session.messages.length >= 199) throw new Error('Session context limit reached. Start a new session.');
    session.messages.push({ role: 'user', content: prompt });
    this.event(session, 'user', prompt);
    session.view = { ...session.view, status: 'running' };
    void this.run(session);
  }
  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Session not found.');
    session.controller.abort(); session.client.close();
    session.view = { ...session.view, status: 'cancelled' };
  }
  close(): void { for (const id of this.sessions.keys()) this.cancel(id); }
  pending() { return [...this.sessions.values()].flatMap(session => session.view.status === "running" ? session.client.pendingHolds().map(hold => ({ ...hold, holdId: `${session.view.id}:${hold.holdId}` })) : []); }
  decide(id: string, decision: { kind: 'approved' | 'denied'; by: string; reason?: string }): boolean {
    const [sessionId, holdId] = id.split(":");
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session && holdId && session.view.status === "running") return session.client.approvals.decide(holdId, decision);
    return false;
  }
  private event(session: Session, kind: SessionEvent['kind'], text: string) {
    session.view = { ...session.view, events: [...session.view.events, { seq: (session.view.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), kind, text: session.provider.redact(text).slice(0, 32000) }].slice(-200) };
  }
  private async run(session: Session): Promise<void> {
    try {
      const listed = await session.client.request('tools/list') as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
      if (!Array.isArray(listed.tools)) throw new Error('MCP server did not return a tool catalog.');
      const mapping = new Map(listed.tools.map((tool, index) => [`tool_${index}`, tool.name]));
      const tools = listed.tools.map((tool, index) => ({ type: 'function', function: { name: `tool_${index}`, description: `${tool.name}: ${tool.description ?? ''}`, parameters: tool.inputSchema ?? { type: 'object', properties: {} } } }));
      for (let turn = 0; turn < 20; turn++) {
        if (session.controller.signal.aborted) return;
        if (session.messages.length >= 200) throw new Error('Session context limit reached. Start a new session.');
        const reply = await session.provider.complete(session.view.model, session.messages, tools, session.controller.signal);
        session.messages.push(reply.message);
        if (reply.message.content) this.event(session, 'assistant', reply.message.content);
        if (reply.usage) this.event(session, 'usage', `${reply.usage.total_tokens ?? 'Unknown'} tokens reported by provider`);
        if ((reply.message.tool_calls?.length ?? 0) > 32) throw new Error('Provider exceeded the 32-tool batch limit.');
        if (!reply.message.tool_calls?.length) { session.view = { ...session.view, status: 'idle' }; return; }
        for (const call of reply.message.tool_calls) {
          if (session.controller.signal.aborted) return;
          const name = mapping.get(call.function.name);
          if (!name) throw new Error('Provider requested a tool outside the approved MCP catalog.');
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Provider returned malformed tool arguments.'); }
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
          this.event(session, 'tool', `Requested ${name}. VOID will decide before execution.`);
          let result: unknown;
          try { result = await session.client.request('tools/call', { name, arguments: args as JsonObject }); }
          catch { result = { isError: true, content: [{ type: 'text', text: 'VOID refused or could not execute this call. Do not retry; ask the operator.' }] }; }
          if (session.controller.signal.aborted) return;
          this.event(session, 'tool', `${name}: ${(result as { isError?: boolean })?.isError ? 'refused or failed' : 'result received'}`);
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: session.provider.redact(JSON.stringify(result)).slice(0, 64000) });
        }
      }
      throw new Error('Session reached the 20-turn limit. Review the ledger before continuing.');
    } catch (error) {
      if (!session.controller.signal.aborted) { this.event(session, 'error', error instanceof Error ? error.message : 'Session failed.'); session.view = { ...session.view, status: 'failed' }; session.client.close(); }
    }
  }
}
