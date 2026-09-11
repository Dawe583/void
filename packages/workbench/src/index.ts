import { LocalStorage } from './storage.ts';
import { catalog as mcpCatalog, rpc, validateEndpoint, type McpTool, type McpConfig } from './mcp.ts';
import { createWorkspace, workspaceTools, executeWorkspaceTool, previewWorkspaceUndo, applyWorkspaceUndo, workspaceToolClass, type WorkspaceState, type WorkspaceOperation } from './workspace.ts';
import { devKeyProvider, sha256Hex } from '../../ledger/src/sign.ts';
import { canonicalJson, entryHash, GENESIS_PREV } from '../../ledger/src/canonical.ts';
import { signingPreimage } from '../../ledger/src/index.ts';
import { verifyChain, readLedgerEntries } from '../../ledger/src/verify.ts';
import type { JsonlEntry } from '../../ledger/src/store.ts';
import { classifyTool } from '../../registry/src/evaluate.ts';
import { loadPolicy } from '../../policy/src/rules.ts';
import { decide } from '../../policy/src/decide.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createVoidClient, type VoidClient } from '../../sdk/src/client.ts';
import { CompatibleProvider, type Model, type ModelMessage, type ProviderConfig } from './provider.ts';
import type { JsonObject } from '../../proxy/src/rpc.ts';

export type SessionEvent = { readonly seq: number; readonly at: string; readonly kind: 'user' | 'assistant' | 'tool' | 'error' | 'usage'; readonly text: string };
export type SessionView = { readonly id: string; readonly workspace: string; readonly model: string; readonly title?: string; readonly status: 'running' | 'idle' | 'cancelled' | 'failed'; readonly events: readonly SessionEvent[] };
export const DEFAULT_POLICY = 'version: 1\nrules:\n  - match:\n      class: r0\n    decision: allow\n  - match: {}\n    decision: hold\n    seconds: 300\n    notify: [cli]\n';
type Connector = McpConfig & { id: string; name: string; tools: McpTool[] };
type Session = { view: SessionView; messages: ModelMessage[]; client?: VoidClient; tools?: McpTool[]; connections?: Record<string, McpConfig & { sessionId?: string }>; config?: ProviderConfig; controller: AbortController; provider: CompatibleProvider };

/** Model tools always cross the existing VOID SDK. A provider has no shell or
 * filesystem authority; operators configure the MCP upstream on the runtime. */
export class Workbench {
  private readonly env: Readonly<NodeJS.ProcessEnv>;
  private provider: CompatibleProvider | undefined;
  private readonly storage: LocalStorage;
  private hasState = false;
  private readonly keyStorage: string;
  private config: ProviderConfig | undefined;
  private profiles: Record<string, ProviderConfig> = {};
  private connectors: Connector[] = [];
  private documents: Record<string, WorkspaceState> = {};
  private evidence: Record<string, JsonlEntry[]> = {};
  private readonly holds = new Map<string, { holdId: string; call: { tool: string; workspace: string; klass: string; blastRadius: number | undefined }; expiresAt: number; status: 'pending' | 'approved' | 'denied'; by?: string; reason?: string; notify: string[] }>();
  private ignoreEnvironment = false;
  private catalog: readonly Model[] = [];
  private readonly sessions = new Map<string, Session>();
  private readonly fetcher: typeof fetch;
  constructor(env: Readonly<NodeJS.ProcessEnv> = process.env, fetcher: typeof fetch = fetch) {
    this.keyStorage = env.VOID_WORKSPACE_KEY ? "os-keychain" : "encrypted-local";
    this.env = { ...env }; delete (this.env as NodeJS.ProcessEnv).VOID_WORKSPACE_KEY; this.fetcher = fetcher;
    this.storage = new LocalStorage(env.VOID_DATA_DIR ?? join(env.VOID_LEDGER_DIR ?? join(homedir(), '.void'), 'workbench'), env.VOID_WORKSPACE_KEY);
    const saved = this.storage.read<{ config?: ProviderConfig; profiles?: Record<string, ProviderConfig>; catalog: readonly Model[]; connectors: Connector[]; documents: Record<string, WorkspaceState>; evidence: Record<string, JsonlEntry[]>; sessions: Array<{ view: SessionView; messages: ModelMessage[]; config?: ProviderConfig; tools?: McpTool[]; connections?: Session['connections'] }> }>();
    if (saved) {
      this.hasState = !!saved.config || !!saved.sessions.length || !!saved.connectors.length;
      this.config = saved.config; this.profiles = saved.profiles ?? {}; this.catalog = saved.catalog; this.connectors = saved.connectors; this.documents = saved.documents; this.evidence = saved.evidence;
      if (this.config) this.provider = new CompatibleProvider(this.config, fetcher);
      for (const item of saved.sessions) {
        const config = item.config ?? this.config;
        if (!config) continue;
        this.sessions.set(item.view.id, { ...item, view: { ...item.view, status: item.view.status === 'running' ? 'failed' : item.view.status }, provider: new CompatibleProvider(config, fetcher), controller: new AbortController() });
      }
    }
  }
  private persist(): void {
    if (!this.hasState && !this.config && !this.sessions.size && !this.connectors.length) return;
    this.storage.save({ config: this.config, profiles: this.profiles, catalog: this.catalog, connectors: this.connectors, documents: this.documents, evidence: this.evidence,
      sessions: [...this.sessions.values()].map(({ view, messages, config, tools, connections }) => ({ view, messages, config, tools, connections })) });
    this.hasState = true;
  }
  async configure(config: ProviderConfig): Promise<readonly Model[]> {
    config = { ...config, apiKey: config.apiKey || this.profiles[config.baseUrl]?.apiKey || '' };
    const provider = new CompatibleProvider(config, this.fetcher);
    const models = await provider.models();
    this.provider = provider; this.config = config; this.profiles[config.baseUrl] = config; this.catalog = models; this.persist();
    return models;
  }
  async providerState() {
    if (!this.provider && !this.ignoreEnvironment && this.env.OPENROUTER_API_KEY) await this.configure({ baseUrl: this.env.VOID_PROVIDER_URL ?? 'https://openrouter.ai/api/v1', apiKey: this.env.OPENROUTER_API_KEY });
    return { connected: this.provider !== undefined, models: this.catalog, keyStorage: this.keyStorage, baseUrl: this.config?.baseUrl, kind: this.config?.kind, profiles: Object.keys(this.profiles), upstreamConfigured: true };
  }
  clearProvider(): void { this.ignoreEnvironment = true; this.provider = undefined; if (this.config) delete this.profiles[this.config.baseUrl]; this.config = undefined; this.catalog = []; this.persist(); }
  list(): readonly SessionView[] { return [...this.sessions.values()].map(session => ({ ...session.view, events: [] })); }
  get(id: string): SessionView | undefined { return this.sessions.get(id)?.view; }
  async start(prompt: string, model: string): Promise<SessionView> { return this.locked(() => this.startSession(prompt, model)); }
  private async startSession(prompt: string, model: string): Promise<SessionView> {
    if (!this.provider) throw new Error('Connect and validate a provider first.');
    const selectedProvider = this.provider, selectedConfig = this.config;
    if (!this.catalog.some(item => item.id === model)) throw new Error('Select a model from the validated catalog.');
    if ([...this.sessions.values()].some(session => session.view.status === 'running')) throw new Error('Wait for the active session or cancel it before starting another.');
    let command: unknown;
    try { command = JSON.parse(this.env.VOID_UPSTREAM_COMMAND ?? 'null'); } catch { throw new Error('VOID_UPSTREAM_COMMAND must be a JSON array.'); }
    if (command !== null && (!Array.isArray(command) || !command.length || !command.every(item => typeof item === 'string' && item.length > 0))) throw new Error('Configure VOID_UPSTREAM_COMMAND on the runtime with the MCP server command as a JSON array.');
    if (command && !this.env.VOID_POLICY_PATH) throw new Error('Configure VOID_POLICY_PATH before starting an agent.');
    if (!prompt.trim() || prompt.length > 32000) throw new Error('Enter a prompt between 1 and 32000 characters.');
    if (this.sessions.size >= 100) throw new Error('Session capacity reached. Restart the runtime after exporting the ledgers.');
    const id = randomUUID();
    const workspace = `agent-${id}`;
    const client = Array.isArray(command) ? createVoidClient({ workspace, ledgerDir: this.env.VOID_LEDGER_DIR ?? join(homedir(), '.void', 'ledger'), connect: { upstreamCommand: command }, policyPath: this.env.VOID_POLICY_PATH!, factsPath: this.env.VOID_FACTS_PATH, posture: 'fail-closed', requestTimeoutMs: 180000 }) : undefined;
    const tools: McpTool[] = [...workspaceTools];
    const connections: NonNullable<Session['connections']> = {};
    for (const connector of this.connectors) {
      const listed = await mcpCatalog(connector);
      connections[connector.id] = { ...connector, sessionId: listed.sessionId };
      tools.push(...listed.tools.map(tool => ({ ...tool, connectorId: connector.id })));
    }
    if (client) {
      const listed = await client.request('tools/list') as { tools: McpTool[] };
      tools.push(...listed.tools.map(tool => ({ ...tool, connectorId: 'stdio' })));
    }
    if ([...this.sessions.values()].some(s => s.view.status === 'running')) { client?.close(); throw new Error('Another session started while connecting tools. Retry after it stops.'); }
    this.documents[workspace] = createWorkspace();
    const session: Session = { view: { id, workspace, model, title: prompt.trim().slice(0, 80), status: 'idle', events: [] }, messages: [{ role: 'system', content: 'You are operating through VOID. Tool calls are classified, governed by policy, and recorded. Respect denied calls; do not retry them with reworded arguments. Wait for operator approval of held calls. Only claim completed actions when tool results prove them. You have a managed document workspace with list, read, write and delete tools. Changes in that workspace are captured and can be undone by the operator. These tools do not access the host filesystem. Use them when asked to create or edit documents.' }], client, tools, connections, config: selectedConfig, controller: new AbortController(), provider: selectedProvider };
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
    this.persist();
    void this.run(session);
  }
  cancel(id: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Session not found.');
    session.controller.abort(); session.client?.close();
    session.view = { ...session.view, status: 'cancelled' }; this.persist();
  }
  close(): void { for (const session of this.sessions.values()) { session.controller.abort(); session.client?.close(); if (session.view.status === 'running') session.view = { ...session.view, status: 'cancelled' }; } this.persist(); }
  pending() { return [...this.holds.values()].filter(h => h.status === 'pending' && h.expiresAt > Date.now()).concat([...this.sessions.values()].flatMap(session => session.view.status === 'running' ? (session.client?.pendingHolds() ?? []).map(hold => ({ ...hold, holdId: `${session.view.id}:${hold.holdId}` })) : []) as never[]); }
  decide(id: string, decision: { kind: 'approved' | 'denied'; by: string; reason?: string }): boolean {
    const local = this.holds.get(id);
    if (local && local.status === 'pending' && local.expiresAt > Date.now()) { local.status = decision.kind; local.by = decision.by; local.reason = decision.reason; return true; }
    const [sessionId, holdId] = id.split(":");
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session && holdId && session.view.status === "running") return session.client?.approvals.decide(holdId, decision) ?? false;
    return false;
  }
  private event(session: Session, kind: SessionEvent['kind'], text: string) {
    session.view = { ...session.view, events: [...session.view.events, { seq: (session.view.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), kind, text: session.provider.redact(text).slice(0, 32000) }].slice(-200) };
  }
  connectionState() { return { connectors: [{ id: 'workspace', name: 'VOID documents', builtin: true, tools: workspaceTools.map(t => t.name), undo: true }, ...this.connectors.map(({ id, name, url, tools }) => ({ id, name, url, tools: tools.map(t => t.name), undo: false }))] }; }
  async addConnector(input: McpConfig & { name?: string }) {
    const url = validateEndpoint(input.url, true);
    const policy = input.policy || DEFAULT_POLICY;
    if (!loadPolicy(policy).ok) throw new Error('Invalid VOID policy.');
    if (this.connectors.length >= 12) throw new Error('Connector limit reached. Remove an unused connector.');
    const listed = await mcpCatalog({ ...input, url });
    const connector = { ...input, url, policy, id: randomUUID(), name: input.name?.trim().slice(0, 80) || new URL(url).hostname, tools: listed.tools };
    this.connectors.push(connector); this.persist();
    return this.connectionState();
  }
  removeConnector(id: string) { this.connectors = this.connectors.filter(c => c.id !== id); this.persist(); }
  workspace(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found.');
    return this.documents[s.view.workspace] ?? createWorkspace();
  }
  async undoPreview(id: string, operationId: string) {
    const state = this.workspace(id), operation = state.operations.find(op => op.id === operationId);
    const proof = await this.ledger(this.sessions.get(id)!.view.workspace);
    const digest = operation ? await sha256Hex(canonicalJson(operation)) : '';
    if (!operation || !proof?.entries.some(e => { const b = e.body as Record<string, unknown>; return b.operationId === operationId && b.decision === 'execute:completed' && b.captureDigest === digest; })) throw new Error('Captured inverse does not match signed evidence.');
    return previewWorkspaceUndo(state, operationId);
  }
  private serial: Promise<unknown> = Promise.resolve();
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn); this.serial = next.catch(() => {}); return next;
  }
  async undo(id: string, operationId: string) {
    return this.locked(async () => {
      const session = this.sessions.get(id);
      if (!session || session.view.status === 'running') throw new Error('Wait for the session to stop before undoing a change.');
      await this.undoPreview(id, operationId);
      const prior = this.workspace(id);
      const transition = applyWorkspaceUndo(this.workspace(id), { id: `undo-${operationId}`, operationId });
      if (transition.result.isError) throw new Error(transition.result.content[0]?.text ?? 'Undo refused.');
      if (transition.state === prior) return { ok: true, workspace: prior };
      await this.commitWorkspace(session, transition.state, 'void_workspace_undo', { operationId }, 'execute:completed', transition.operation);
      this.event(session, 'tool', `Undid ${transition.operation?.path ?? operationId}.`); this.persist();
      return { ok: true, workspace: transition.state };
    });
  }
  async ledger(workspace: string) {
    if (!Object.hasOwn(this.documents, workspace)) return undefined;
    const entries = this.evidence[workspace] ?? [], key = await devKeyProvider({ dir: join(this.storage.directory, 'keys'), env: this.env });
    const result = await verifyChain(entries, { publicKey: id => key.publicKey(id) });
    if (!result.ok) throw new Error('Workspace ledger signature verification failed.');
    return { entries, result };
  }
  private async commitWorkspace(session: Session, state: WorkspaceState, tool: string, args: unknown, decision: string, operation?: WorkspaceOperation, approval?: { by?: string; reason?: string }, metadata?: Record<string, unknown>) {
    const workspace = session.view.workspace;
    const current = this.evidence[workspace] ?? [];
    const key = await devKeyProvider({ dir: join(this.storage.directory, 'keys'), env: this.env });
    const body = { ...(approval?.by ? { approvedBy: approval.by } : {}), ...(approval?.reason ? { approvalReason: approval.reason } : {}), workspace, at: new Date().toISOString(), tool, klass: workspaceToolClass(tool) ?? (tool === 'void_workspace_undo' ? 'r1' : 'r3'), decision,
      argsDigest: `sha256:${await sha256Hex(canonicalJson(args))}`, ...(operation ? { operationId: operation.id, captureDigest: await sha256Hex(canonicalJson(operation)) } : {}), ...metadata };
    const previous = current.at(-1)?.hash ?? GENESIS_PREV, hash = await entryHash(body, previous, sha256Hex), keyId = await key.currentKeyId();
    const entry: JsonlEntry = { workspace, seq: current.length + 1, body, prev_hash: previous, hash, key_id: keyId, alg: key.alg,
      signature: `${key.alg}:${Buffer.from(await key.sign(signingPreimage(key.alg, keyId, hash))).toString('base64')}` };
    const before = this.documents[workspace];
    this.documents[workspace] = state; this.evidence[workspace] = [...current, entry];
    try { this.persist(); }
    catch (error) { this.documents[workspace] = before!; this.evidence[workspace] = current; throw error; }
  }
  private async syncStdio(session: Session) {
    return this.locked(async () => {
      const path = join(this.env.VOID_LEDGER_DIR ?? join(homedir(), '.void', 'ledger'), `${session.view.workspace}.jsonl`);
      let entries: JsonlEntry[];
      try { entries = await readLedgerEntries(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      // The SDK uses this same signer. Preserve and link the original signed
      // authorization events instead of hiding them behind the document ledger.
      const key = await devKeyProvider();
      const verified = await verifyChain(entries, { publicKey: id => key.publicKey(id) });
      if (!verified.ok) throw new Error('The stdio proxy ledger failed verification.');
      for (const entry of entries) {
        if (this.evidence[session.view.workspace]?.some(e => (e.body as Record<string, unknown>).sourceDigest === entry.hash)) continue;
        const body = entry.body as Record<string, unknown>;
        await this.commitWorkspace(session, this.workspace(session.view.id), String(body.tool), {}, String(body.decision), undefined, undefined, { ...body, source: 'stdio-proxy', sourceDigest: entry.hash });
      }
    });
  }
  private async execute(session: Session, tool: McpTool, args: JsonObject, id: string): Promise<unknown> {
    if (tool.connectorId === 'stdio') {
      if (!session.client) throw new Error('This stdio connection ended. Start a new session.');
      try { return await session.client.request('tools/call', { name: tool.name, arguments: args }); }
      finally { await this.syncStdio(session); }
    }
    if (!tool.connectorId) return this.locked(async () => {
      await this.ledger(session.view.workspace);
      const transition = executeWorkspaceTool(this.workspace(session.view.id), { id, name: tool.name, arguments: args });
      await this.commitWorkspace(session, transition.state, tool.name, args, transition.result.isError ? 'execute:failed' : 'execute:completed', transition.operation);
      return transition.result;
    });
    const config = session.connections?.[tool.connectorId];
    if (!config) throw new Error('Connector not available in this session.');
    const name = config.mapping?.[tool.name] ?? tool.name;
    const classification = classifyTool(name, { facts: config.facts ?? {}, args });
    const call = { tool: name, workspace: session.view.workspace, klass: classification.outcome === 'classified' ? classification.tone : 'r3', connector: tool.connectorId, blastRadius: undefined };
    const policy = loadPolicy(config.policy ?? DEFAULT_POLICY);
    if (!policy.ok) throw new Error('Invalid policy.');
    const decision = classification.outcome === 'classified' ? decide(policy, call) : { kind: 'deny' as const };
    await this.locked(() => this.commitWorkspace(session, this.workspace(session.view.id), name, args, decision.kind, undefined, undefined, { klass: call.klass }));
    let allowed = decision.kind === 'allow';
    if (decision.kind === 'hold') {
      const hold: { holdId: string; call: typeof call; expiresAt: number; status: 'pending' | 'approved' | 'denied'; notify: string[]; by?: string; reason?: string } = { holdId: `${session.view.id}:${randomUUID()}`, call, expiresAt: Date.now() + decision.seconds * 1000, status: 'pending' as 'pending' | 'approved' | 'denied', notify: [] };
      this.holds.set(hold.holdId, hold);
      this.event(session, 'tool', `${name}: waiting for your approval.`);
      while (hold.status === 'pending' && hold.expiresAt > Date.now() && !session.controller.signal.aborted) await delay(100);
      allowed = hold.status === 'approved' && !session.controller.signal.aborted;
      await this.locked(() => this.commitWorkspace(session, this.workspace(session.view.id), name, args, allowed ? "hold:approved" : "hold:denied", undefined, hold, { klass: call.klass }));
      this.holds.delete(hold.holdId);
    }
    if (!allowed) return { isError: true, content: [{ type: 'text', text: `VOID denied ${name} (${call.klass}). Review the connector policy and explicit registry mapping. Do not retry.` }] };
    if (session.controller.signal.aborted) throw new Error('Session cancelled.');
    let result;
    try { result = await rpc(config, 'tools/call', { name: tool.name, arguments: args }, config.sessionId); }
    catch (error) { await this.locked(() => this.commitWorkspace(session, this.workspace(session.view.id), name, args, 'execute:unknown', undefined, undefined, { klass: call.klass })); throw error; }
    await this.locked(() => this.commitWorkspace(session, this.workspace(session.view.id), name, args, result.result?.isError ? 'execute:failed' : 'execute:completed', undefined, undefined, { klass: call.klass }));
    return config.token ? JSON.parse(JSON.stringify(result.result).split(config.token).join('[redacted]')) as unknown : result.result;
  }
  private async run(session: Session): Promise<void> {
    try {
      const listed = { tools: session.tools ?? [...workspaceTools] };
      const mapping = new Map(listed.tools.map((tool, index) => [`tool_${index}`, tool]));
      const tools = listed.tools.map((tool, index) => ({ type: 'function', function: { name: `tool_${index}`, description: `${tool.name}: ${tool.description ?? ''}`, parameters: tool.inputSchema ?? { type: 'object', properties: {} } } }));
      for (let turn = 0; turn < 20; turn++) {
        if (session.controller.signal.aborted) return;
        if (session.messages.length >= 200) throw new Error('Session context limit reached. Start a new session.');
        const reply = await session.provider.complete(session.view.model, session.messages, tools, session.controller.signal);
        session.messages.push(reply.message);
        if (reply.message.content) this.event(session, 'assistant', reply.message.content);
        if (reply.usage) this.event(session, 'usage', `${reply.usage.total_tokens ?? 'Unknown'} tokens reported by provider`);
        if ((reply.message.tool_calls?.length ?? 0) > 32) throw new Error('Provider exceeded the 32-tool batch limit.');
        if (!reply.message.tool_calls?.length) { session.view = { ...session.view, status: 'idle' }; this.persist(); return; }
        for (const call of reply.message.tool_calls) {
          if (session.controller.signal.aborted) return;
          const tool = mapping.get(call.function.name);
          const name = tool?.name;
          if (!name) throw new Error('Provider requested a tool outside the approved MCP catalog.');
          let args: unknown;
          try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Provider returned malformed tool arguments.'); }
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
          this.event(session, 'tool', `Requested ${name}. VOID will decide before execution.`);
          let result: unknown;
          try { result = await this.execute(session, tool!, args as JsonObject, `${session.view.id}-${session.messages.length}-${call.id}`); }
          catch { result = { isError: true, content: [{ type: 'text', text: 'VOID refused or could not execute this call. Do not retry; ask the operator.' }] }; }
          if (session.controller.signal.aborted) return;
          this.event(session, 'tool', `${name}: ${(result as { isError?: boolean })?.isError ? 'refused or failed' : 'result received'}`);
          session.messages.push({ role: 'tool', tool_call_id: call.id, content: session.provider.redact(JSON.stringify(result)).slice(0, 64000) });
        }
      }
      throw new Error('Session reached the 20-turn limit. Review the ledger before continuing.');
    } catch (error) {
      if (!session.controller.signal.aborted) { this.event(session, 'error', error instanceof Error ? error.message : 'Session failed.'); session.view = { ...session.view, status: 'failed' }; session.client?.close(); }
    } finally { this.persist(); }
  }
}
