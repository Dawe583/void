export class ProviderRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, code?: string) {
    super(code === 'customer_verification_required' ? 'Vercel AI Gateway requires account verification. Add a card in Vercel AI Gateway settings or connect your own provider key.' : `Provider request failed (HTTP ${status}). Check credentials, model access or rate limits.`);
    this.status = status; this.code = code;
  }
}
export type ProviderConfig = { readonly baseUrl: string; readonly apiKey: string; readonly kind?: "openai" | "anthropic" };
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
    return body.data.filter((model: unknown): model is { id: string; name?: string; display_name?: string } => typeof model === 'object' && model !== null && 'id' in model && typeof model.id === 'string' && (!('type' in model) || model.type === 'language' || (this.config.kind === 'anthropic' && model.type === 'model'))).map((model: { id: string; name?: string; display_name?: string }) => ({ id: model.id, name: model.display_name ?? (typeof model.name === "string" ? model.name : model.id) }));
  }
  async complete(model: string, messages: readonly ModelMessage[], tools: readonly unknown[], signal: AbortSignal): Promise<ModelReply> {
    if (this.config.kind === 'anthropic') return this.anthropic(model, messages, tools, signal);
    const body = await this.json('chat/completions', { model, messages, ...(tools.length ? { tools } : {}), ...(this.base.hostname === 'api.openai.com' ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }), stream: false }, signal);
    const message = body.choices?.[0]?.message;
    if (message?.role !== 'assistant' || (message.content !== null && typeof message.content !== 'string' && message.content !== undefined)) throw new Error('Provider returned an invalid response.');
    if (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || !message.tool_calls.every((call: ToolCall) => typeof call.id === 'string' && call.type === 'function' && typeof call.function?.name === 'string' && typeof call.function?.arguments === 'string'))) throw new Error('Provider returned invalid tool calls.');
    return { message: { role: 'assistant', content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) }, usage: body.usage };
  }
  private async anthropic(model: string, messages: readonly ModelMessage[], tools: readonly unknown[], signal: AbortSignal): Promise<ModelReply> {
    const converted: Array<{ role: string; content: unknown }> = [];
    for (const m of messages.filter(item => item.role !== 'system')) {
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' };
        const previous = converted.at(-1);
        if (previous?.role === 'user' && Array.isArray(previous.content)) previous.content.push(block);
        else converted.push({ role: 'user', content: [block] });
      } else if (m.tool_calls?.length) converted.push({ role: 'assistant', content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.tool_calls.map(call => ({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) as unknown })),
      ] });
      else converted.push({ role: m.role, content: m.content ?? '' });
    }
    const body = await this.json('messages', { model, max_tokens: 4096,
      system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: converted,
      ...(tools.length ? { tools: tools.map(value => { const tool = value as { function: { name: string; description: string; parameters: unknown } }; return { name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }; }) } : {}),
    }, signal);
    const result = body as unknown as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number } };
    if (!Array.isArray(result.content)) throw new Error('Provider returned an invalid Anthropic response.');
    const calls: ToolCall[] = result.content.filter(b => b.type === 'tool_use').map(b => {
      if (!b.id || !b.name || !b.input || typeof b.input !== 'object') throw new Error('Invalid Anthropic tool call.');
      return { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } };
    });
    return { message: { role: 'assistant', content: result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n'), ...(calls.length ? { tool_calls: calls } : {}) },
      usage: { total_tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) } };
  }
  redact(text: string): string { return this.config.apiKey ? text.split(this.config.apiKey).join('[redacted]') : text; }
  private async json(path: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.request(new URL(path, this.base), { method: body === undefined ? 'GET' : 'POST', headers: { ...(this.config.kind === 'anthropic' ? { 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' } : this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(15000) });
    } catch { throw new Error(signal?.aborted ? 'Session cancelled.' : 'Provider connection failed. Check its endpoint and availability.'); }
    if (!response.ok) {
      let code: string | undefined;
      if (response.status === 403) { try { const error = await response.json() as { error?: { type?: string } }; if (error.error?.type === 'customer_verification_required') code = error.error.type; } catch {} }
      throw new ProviderRequestError(response.status, code);
    }
    // Provider JSON is untrusted. Runtime validation below narrows the fields
    // consumed by the workbench without exposing provider error payloads.
    try { return await response.json() as { data?: unknown; choices?: Array<{ message?: ModelMessage }>; usage?: ModelReply["usage"] }; }
    catch { throw new Error("Provider returned invalid JSON."); }
  }
}
