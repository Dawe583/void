import test from 'node:test';
import assert from 'node:assert/strict';
import { CompatibleProvider } from './provider.ts';
test('Anthropic models, native tool messages and usage share the agent interface', async () => {
  let requestBody: Record<string, unknown> = {};
  const provider = new CompatibleProvider({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'secret', kind: 'anthropic' }, async (url, options) => {
    assert.equal((options?.headers as Record<string, string>)['x-api-key'], 'secret');
    assert.equal((options?.headers as Record<string, string>).authorization, undefined);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'claude-fixture', type: 'model', display_name: 'Claude fixture' }] });
    assert.ok(String(url).endsWith('/messages'));
    requestBody = JSON.parse(String(options?.body));
    return Response.json({ content: [{ type: 'text', text: 'Writing.' }, { type: 'tool_use', id: 'toolu_1', name: 'tool_0', input: { path: 'plan.md', content: 'Plan' } }], usage: { input_tokens: 20, output_tokens: 10 } });
  });
  assert.equal((await provider.models())[0]?.name, 'Claude fixture');
  const result = await provider.complete('claude-fixture', [
    { role: 'system', content: 'Respect VOID.' }, { role: 'user', content: 'Write a plan.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'tool_0', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'old', content: 'Done' },
  ], [{ type: 'function', function: { name: 'tool_0', description: 'Write', parameters: { type: 'object' } } }], new AbortController().signal);
  assert.equal(requestBody.system, 'Respect VOID.');
  assert.deepEqual((requestBody.messages as Array<{ content: unknown }>).at(-1)?.content, [{ type: 'tool_result', tool_use_id: 'old', content: 'Done' }]);
  assert.equal(result.message.tool_calls?.[0]?.function.arguments, '{"path":"plan.md","content":"Plan"}');
  assert.equal(result.usage?.total_tokens, 30);
});
