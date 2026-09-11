// Real disposable MCP/provider HTTP services and the provisioned cloud database.
// No paid model is used in this connector safety check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
Object.assign(
  process.env,
  JSON.parse(await readFile(".env.cloud-secrets", "utf8")),
);
const { transaction, write, read, encrypt, ledger, database } =
  await import("../../cloud/store.mjs");
const { advance, CLOUD_POLICY } = await import("../../cloud/steps.mjs");
let mutations = 0;
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw);
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/chat/completions")
    return res.end(
      JSON.stringify({
        choices: [
          {
            message:
              input.messages.at(-1).role === "tool"
                ? { role: "assistant", content: "Done" }
                : {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "fixture-call",
                        type: "function",
                        function: {
                          name: "tool_0",
                          arguments: '{"bucket":"fixture","key":"fixture"}',
                        },
                      },
                    ],
                  },
          },
        ],
      }),
    );
  mutations++;
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: input.id,
      result: {
        content: [{ type: "text", text: "disposable mutation executed fixture-mcp-secret" }],
      },
    }),
  );
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${fixture.address().port}`;
try {
  for (const resolution of ["denied", "approved"]) {
    const id = randomUUID(),
      workspace = `qa-${id}`;
    await write(`session:${id}`, {
      id,
      workspace,
      createdAt: new Date().toISOString(),
      model: "fixture",
      status: "running",
      events: [],
      messages: [{ role: "user", content: "Test disposable tool" }],
      tools: [{ name: "aws.s3.object.delete" }],
      upstream: encrypt({ url: base + "/mcp", token: "fixture-mcp-secret", policy: CLOUD_POLICY }),
      provider: {
        secret: encrypt({ baseUrl: base + "/v1", apiKey: "fixture-only" }),
      },
      generation: 1,
      turn: 0,
      queue: [],
    });
    assert.equal(await advance(id, 1), "next");
    assert.equal(await advance(id, 1), "wait");
    assert.equal(mutations, resolution === "approved" ? 0 : 0);
    const s = await read(`session:${id}`);
    await transaction(id, async (c) => {
      const hold = await read(`hold:${s.pending.id}`, c);
      hold.status = resolution;
      hold.decidedAt = Date.now();
      await write(`hold:${hold.holdId}`, hold, c);
    });
    assert.equal(await advance(id, 1), "next");
    assert.equal(mutations, resolution === "approved" ? 1 : 0);
    await advance(id, 1);
    assert.equal((await read(`session:${id}`)).status, "idle");
    assert.ok(!JSON.stringify(await read(`session:${id}`)).includes("fixture-mcp-secret"));
    const verified = await ledger(workspace);
    assert.equal(verified.result.ok, true);
    assert.ok(
      verified.entries.some((e) => e.body.decision === `hold:${resolution}`),
    );
    await assert.rejects(
      database().query(
        "UPDATE void_cloud_ledger SET seq=seq WHERE workspace=$1",
        [workspace],
      ),
      /append only/,
    );
    console.log(
      `PASS cloud ${resolution}: durable decision, signed ledger and immutable rows`,
    );
  }
  const id = randomUUID();
  await write(`session:${id}`, {
    id,
    workspace: `qa-${id}`,
    status: "running",
    generation: 1,
    executing: "tool",
    events: [],
  });
  assert.equal(await advance(id, 1), "done");
  assert.equal((await read(`session:${id}`)).status, "failed");
  assert.equal(mutations, 1);
  console.log("PASS interrupted execution refuses automatic retry");
} finally {
  await new Promise((r) => fixture.close(r));
  await database().end();
}
