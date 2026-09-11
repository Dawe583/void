export type ProviderConfig = { readonly baseUrl: string; readonly apiKey: string };
export type Model = { readonly id: string; readonly name: string };
export type ModelMessage = { readonly role: 'system' | 'user' | 'assistant' | 'tool'; readonly content: string | null; readonly tool_calls?: readonly ToolCall[]; readonly tool_call_id?: string };
export type ToolCall = { readonly id: string; readonly type: 'function'; readonly function: { readonly name: string; readonly arguments: string } };
export type ModelReply = { readonly message: ModelMessage; readonly usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };

export class CompatibleProvider {
  private readonly base: URL;
  private readonly config: ProviderConfig;
  private readonly request: typeof fetch;
  constructor(config: ProviderConfig, request: typeof fetch = fetch) {
    this.config = config; this.request = request;
    this.base = new URL(config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`);
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname))) throw new Error('Providers require HTTPS, or loopback HTTP for a local model.');
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('Provider URL cannot contain credentials or query parameters.');
  }
  async models(): Promise<readonly Model[]> {
    const body = await this.json('models');
    if (!Array.isArray(body.data)) throw new Error('Provider returned an invalid model catalog.');
    return body.data.filter((model: unknown): model is { id: string; name?: string } => typeof model === 'object' && model !== null && 'id' in model && typeof model.id === 'string').map((model: { id: string; name?: string }) => ({ id: model.id, name: typeof model.name === "string" ? model.name : model.id }));
  }
  async complete(model: string, messages: readonly ModelMessage[], tools: readonly unknown[], signal: AbortSignal): Promise<ModelReply> {
    const body = await this.json('chat/completions', { model, messages, ...(tools.length ? { tools } : {}), max_tokens: 4096, stream: false }, signal);
    const message = body.choices?.[0]?.message;
    if (message?.role !== 'assistant' || (message.content !== null && typeof message.content !== 'string' && message.content !== undefined)) throw new Error('Provider returned an invalid response.');
    if (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || !message.tool_calls.every((call: ToolCall) => typeof call.id === 'string' && call.type === 'function' && typeof call.function?.name === 'string' && typeof call.function?.arguments === 'string'))) throw new Error('Provider returned invalid tool calls.');
    return { message: { role: 'assistant', content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) }, usage: body.usage };
  }
  redact(text: string): string { return this.config.apiKey ? text.split(this.config.apiKey).join('[redacted]') : text; }
  private async json(path: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.request(new URL(path, this.base), { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(15000) });
    } catch { throw new Error(signal?.aborted ? 'Session cancelled.' : 'Provider connection failed. Check its endpoint and availability.'); }
    if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}). Check credentials, model access or rate limits.`);
    // Provider JSON is untrusted. Runtime validation below narrows the fields
    // consumed by the workbench without exposing provider error payloads.
    try { return await response.json() as { data?: unknown; choices?: Array<{ message?: ModelMessage }>; usage?: ModelReply["usage"] }; }
    catch { throw new Error("Provider returned invalid JSON."); }
  }
}
