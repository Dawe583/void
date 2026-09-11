import { DEFAULT_MODEL_ID, DEFAULT_MODEL_NAME } from './provider-defaults.ts';
export class ProviderRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryAfter: number | undefined;
  constructor(status: number, code?: string, retryAfter?: number) {
    super(code === 'customer_verification_required' ? 'Vercel AI Gateway requires account verification. Add a card in Vercel AI Gateway settings or connect your own provider key.' : `Provider request failed (HTTP ${status}). Check credentials, model access or rate limits.`);
    this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
export type ProviderConfig = { readonly baseUrl: string; readonly apiKey: string; readonly kind?: "openai" | "anthropic" };
export type Model = { readonly id: string; readonly name: string; readonly contextWindow?: number; readonly inputPrice?: string; readonly outputPrice?: string; readonly capabilities?: readonly string[] };
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
    return body.data.filter((model: unknown): model is { id: string; name?: string; display_name?: string } => typeof model === 'object' && model !== null && 'id' in model && typeof model.id === 'string' && (!('type' in model) || model.type === 'language' || (this.config.kind === 'anthropic' && model.type === 'model'))).map((model: { id: string; name?: string; display_name?: string }) => ({ id: model.id, name: model.id === DEFAULT_MODEL_ID ? DEFAULT_MODEL_NAME : model.display_name ?? (typeof model.name === "string" ? model.name : model.id) }));
  }
  async complete(model: string, messages: readonly ModelMessage[], tools: readonly unknown[], signal: AbortSignal, onDelta?: (text: string) => void | Promise<void>): Promise<ModelReply> {
    if (this.config.kind === 'anthropic') return this.anthropic(model, messages, tools, signal);
    const response = await this.response('chat/completions', { model, messages, ...(tools.length ? { tools } : {}), ...(this.base.hostname === 'api.openai.com' ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }), stream: !!onDelta, ...(onDelta ? { stream_options: { include_usage: true } } : {}) }, signal);
    if (response.headers.get('content-type')?.includes('text/event-stream')) return this.streamReply(response, signal, onDelta);
    const body = await this.decode(response);
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
      usage: result.usage ? { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens, total_tokens: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0) } : undefined };
  }
  redact(text: string): string { return this.config.apiKey ? text.split(this.config.apiKey).join('[redacted]') : text; }
  private async streamReply(response: Response, signal: AbortSignal, onDelta?: (text: string) => void | Promise<void>): Promise<ModelReply> {
    if (!response.body) throw new Error('Provider returned an empty stream.');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', content = '', terminal = false, finish = false, emission = '';
    const emit = async (text: string, flush = false) => {
      emission = this.redact(emission + text);
      let hold = 0;
      if (!flush) for (let i = 1; i < this.config.apiKey.length; i++) if (emission.endsWith(this.config.apiKey.slice(0, i))) hold = i;
      const visible = emission.slice(0, emission.length - hold);
      emission = hold ? emission.slice(-hold) : '';
      if (visible) await onDelta?.(visible);
    };
    let usage: ModelReply['usage'];
    const calls = new Map<number, ToolCall>();
    const consume = async (frame: string) => {
      const raw = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!raw) return;
      if (raw === '[DONE]') { terminal = true; return; }
      let chunk;
      try { chunk = JSON.parse(raw); } catch { throw new Error('Provider returned malformed stream data.'); }
      if (chunk.error) throw new Error('Provider reported a streaming error.');
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.find((item: { index?: number }) => (item.index ?? 0) === 0);
      if (!choice) return;
      if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') throw new Error('Provider response was truncated. No tools were executed.');
      if (choice.finish_reason) finish = true;
      const delta = choice.delta;
      if (!delta) return;
      if (typeof delta.content === 'string') {
        content += delta.content;
        if (content.length > 2_000_000) throw new Error('Provider response exceeded the supported size.');
        await emit(delta.content);
      }
      for (const part of delta.tool_calls ?? []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 31) throw new Error('Provider returned invalid tool stream index.');
        const previous = calls.get(part.index);
        const id = part.id ?? previous?.id ?? '';
        const name = (previous?.function.name ?? '') + (part.function?.name ?? '');
        const args = (previous?.function.arguments ?? '') + (part.function?.arguments ?? '');
        if (typeof id !== 'string' || typeof name !== 'string' || typeof args !== 'string' || args.length > 1_000_000) throw new Error('Provider returned invalid tool stream data.');
        calls.set(part.index, { id, type: 'function', function: { name, arguments: args } });
      }
    };
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        pending = pending.replace(/\r\n/g, '\n');
        if (pending.length > 2_000_000) throw new Error('Provider stream frame exceeded the supported size.');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          await consume(frame);
        }
        if (terminal || done) break;
      }
      if (pending.trim() && !terminal) await consume(pending);
      if (!terminal && !finish) throw new Error('Provider stream ended before completion. Retry the response.');
      if (calls.size && !finish) throw new Error('Provider tool stream ended without a finish reason.');
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => {
        if (!call.id || !call.function.name) throw new Error('Provider returned an incomplete tool call.');
        try {
          const args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error();
        } catch { throw new Error('Provider returned invalid tool arguments.'); }
        return call;
      });
      await emit('', true);
      return { message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async response(path: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.request(new URL(path, this.base), { method: body === undefined ? 'GET' : 'POST', headers: { ...(this.config.kind === 'anthropic' ? { 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' } : this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(15000) });
    } catch { throw new Error(signal?.aborted ? 'Session cancelled.' : 'Provider connection failed. Check its endpoint and availability.'); }
    if (!response.ok) {
      let code: string | undefined;
      if (response.status === 403) { try { const error = await response.json() as { error?: { type?: string } }; if (error.error?.type === 'customer_verification_required') code = error.error.type; } catch {} }
      const rawRetry = response.headers.get('retry-after');
      const retryAfter = rawRetry ? (/^\d+$/.test(rawRetry) ? Number(rawRetry) : Math.max(0, Math.ceil((Date.parse(rawRetry) - Date.now()) / 1000))) : undefined;
      throw new ProviderRequestError(response.status, code, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    return response;
  }
  private async json(path: string, body?: unknown, signal?: AbortSignal) { return this.decode(await this.response(path, body, signal)); }
  private async decode(response: Response) {
    // Provider JSON is untrusted. Runtime validation below narrows the fields
    // consumed by the workbench without exposing provider error payloads.
    try { return await response.json() as { data?: unknown; choices?: Array<{ message?: ModelMessage }>; usage?: ModelReply["usage"] }; }
    catch { throw new Error("Provider returned invalid JSON."); }
  }
}
