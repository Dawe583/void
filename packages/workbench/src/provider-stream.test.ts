import { test } from "node:test";
import assert from "node:assert/strict";
import { CompatibleProvider, ProviderRequestError } from "./provider.ts";
const config = {
  baseUrl: "https://api.tokenrouter.com/v1",
  apiKey: "fixture-secret",
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("stream preserves split UTF-8 and CRLF frames, text, tools and final usage", async () => {
  const text =
    frame({ choices: [{ delta: { content: "Příliš žluťoučký" } }] }) +
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: { name: "write", arguments: '{"path":' },
              },
            ],
          },
        },
      ],
    }) +
    frame({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"plan.md"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    }) +
    frame({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }) +
    "data: [DONE]\r\n\r\n";
  const provider = new CompatibleProvider(config, async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "z-ai/glm-5.3-free");
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    return stream(text);
  });
  const deltas: string[] = [];
  const result = await provider.complete(
    "z-ai/glm-5.3-free",
    [],
    [],
    new AbortController().signal,
    (t) => {
      deltas.push(t);
    },
  );
  assert.equal(deltas.join(""), "Příliš žluťoučký");
  assert.equal(
    result.message.tool_calls?.[0]?.function.arguments,
    '{"path":"plan.md"}',
  );
  assert.equal(result.usage?.total_tokens, 20);
});
test("partial tool stream never returns executable tools", async () => {
  const provider = new CompatibleProvider(config, async () =>
    stream(
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "x",
                  function: { name: "write", arguments: "{" },
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  await assert.rejects(
    provider.complete("m", [], [], new AbortController().signal, () => {}),
    /ended before completion/,
  );
});
test("JSON-only compatible providers remain supported without a second request", async () => {
  let calls = 0;
  const provider = new CompatibleProvider(config, async () => {
    calls++;
    return Response.json({
      choices: [{ message: { role: "assistant", content: "Done" } }],
    });
  });
  assert.equal(
    (
      await provider.complete(
        "m",
        [],
        [],
        new AbortController().signal,
        () => {},
      )
    ).message.content,
    "Done",
  );
  assert.equal(calls, 1);
});
test("rate limit exposes retry interval without leaking provider error body", async () => {
  const provider = new CompatibleProvider(
    config,
    async () =>
      new Response("fixture-secret", {
        status: 429,
        headers: { "retry-after": "12" },
      }),
  );
  await assert.rejects(
    provider.models(),
    (e: unknown) =>
      e instanceof ProviderRequestError &&
      e.retryAfter === 12 &&
      !e.message.includes("fixture-secret"),
  );
});
test("stream redacts a secret split across provider chunks", async () => {
  const text =
    frame({ choices: [{ delta: { content: "Result fixture-" } }] }) +
    frame({
      choices: [{ delta: { content: "secret end" }, finish_reason: "stop" }],
    }) +
    "data: [DONE]\n\n";
  const p = new CompatibleProvider(config, async () => stream(text));
  let output = "";
  await p.complete("m", [], [], new AbortController().signal, (t) => {
    output += t;
  });
  assert.equal(output, "Result [redacted] end");
});
test("truncated model output is never accepted as a tool action", async () => {
  const text = frame({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: "x", function: { name: "write", arguments: "{}" } },
          ],
        },
        finish_reason: "length",
      },
    ],
  });
  const p = new CompatibleProvider(config, async () => stream(text));
  await assert.rejects(
    p.complete("m", [], [], new AbortController().signal, () => {}),
    /truncated/,
  );
});
