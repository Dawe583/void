import test from "node:test";
import assert from "node:assert/strict";
import { rpc, validateEndpoint } from "../../cloud/mcp.mjs";
import { encrypt, decrypt } from "../../cloud/store.mjs";
test("cloud MCP rejects credential URLs and local network literals", () => {
  for (const url of [
    "http://example.com",
    "https://127.0.0.1/mcp",
    "https://user:password@example.com/mcp",
    "https://localhost/mcp",
  ])
    assert.throws(() => validateEndpoint(url));
  assert.equal(
    validateEndpoint("https://tools.example.com/mcp"),
    "https://tools.example.com/mcp",
  );
});
test("cloud secrets are authenticated and ciphertext tampering is refused", (t) => {
  const previous = process.env.VOID_SECRET_KEY;
  process.env.VOID_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
  t.after(() => {
    if (previous === undefined) delete process.env.VOID_SECRET_KEY;
    else process.env.VOID_SECRET_KEY = previous;
  });
  const secret = encrypt({ key: "private-test-value" });
  assert.ok(!secret.includes("private-test-value"));
  assert.deepEqual(decrypt(secret), { key: "private-test-value" });
  const parts = secret.split(".");
  const changed = Buffer.from(parts[2], "base64");
  changed[0] ^= 1;
  parts[2] = changed.toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
test("MCP consumes its matching SSE result without waiting for stream closure", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const { id } = JSON.parse(options.body);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: "Žluťoučký" } })}\n\n`,
            ),
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  assert.deepEqual(
    (await rpc({ url: "https://tools.example.com/mcp" }, "tools/list", {}))
      .result,
    { content: "Žluťoučký" },
  );
  assert.equal(cancelled, true);
});

test("cloud API authenticates cookies and bearer tokens and rejects cross-origin requests", async (t) => {
  const { createServer } = await import("node:http");
  const { default: app } = await import("../../cloud/server.mjs");
  const previous = process.env.VOID_CONTROL_TOKEN;
  const token = "cloud-test-token-".repeat(3);
  process.env.VOID_CONTROL_TOKEN = token;
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.VOID_CONTROL_TOKEN;
    else process.env.VOID_CONTROL_TOKEN = previous;
  });
  assert.equal((await fetch(url + "/api/not-found")).status, 401);
  assert.equal(
    (
      await fetch(url + "/api/not-found", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(url + "/api/not-found", {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://untrusted.example",
        },
      })
    ).status,
    403,
  );
  const login = await fetch(url + "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(
    (
      await fetch(url + "/api/not-found", {
        headers: { cookie: cookie.split(";")[0] },
      })
    ).status,
    404,
  );
});
