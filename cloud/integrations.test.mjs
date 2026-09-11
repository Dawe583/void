import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { read, write, encrypt, database, decrypt } from "./store.mjs";
import { integrationConfig } from "./integrations.mjs";
import { PROVIDERS } from "./oauth.mjs";
test(
  "OAuth HTTP lifecycle: auth, CSRF, binding, denial, replay, refresh, context and disconnect",
  { skip: process.env.VOID_OAUTH_DATABASE_TEST !== "1" },
  async (t) => {
    assert.equal(
      new URL(process.env.DATABASE_URL).pathname,
      "/void_gui_upgrade_preview",
      "Only isolated GUI preview database is permitted.",
    );
    const { default: app } = await import("./server.mjs");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port,
      nativeFetch = globalThis.fetch;
    const sessionId = "qa-oauth-" + randomUUID();
    const keys = [
        "integration:client:supabase",
        "integration:supabase",
        "integration:version:supabase",
        "session:" + sessionId,
      ],
      previous = await Promise.all(keys.map((k) => read(k)));
    let exchanges = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url) === PROVIDERS.supabase.token) {
        exchanges++;
        return Response.json({
          access_token: "isolated-secret-token",
          refresh_token: "isolated-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (String(url) === PROVIDERS.supabase.url) {
        const b = JSON.parse(init.body);
        if (b.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        return Response.json({
          jsonrpc: "2.0",
          id: b.id,
          result:
            b.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "list_projects",
                      description: "Read projects",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                }
              : {
                  protocolVersion: "2025-03-26",
                  capabilities: { tools: {} },
                  serverInfo: { name: "isolated-service", version: "1" },
                },
        });
      }
      return nativeFetch(url, init);
    };
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      try {
        for (let i = 0; i < keys.length; i++)
          await write(keys[i], previous[i] ?? null);
        // The isolated database intentionally retains append-only test events.
        // Restore mutable state without disabling its audit immutability trigger.
      } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        await database().end();
      }
    });
    await write(
      keys[0],
      encrypt({
        client_id: "isolated-client",
        client_secret: "isolated-client-secret",
      }),
    );
    await write(keys[1], null);
    const request = (path, method = "GET", body, extra = {}) =>
      nativeFetch(base + path, {
        method,
        headers: {
          authorization: "Bearer " + process.env.VOID_CONTROL_TOKEN,
          "content-type": "application/json",
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
    assert.equal((await nativeFetch(base + "/api/integrations")).status, 401);
    assert.equal(
      (
        await request(
          "/api/integrations/supabase/start",
          "POST",
          {},
          { origin: "https://attacker.test" },
        )
      ).status,
      403,
    );
    const start = await request("/api/integrations/supabase/start", "POST"),
      cookie = start.headers.get("set-cookie").split(";")[0],
      url = new URL((await start.json()).url),
      state = url.searchParams.get("state");
    assert.match(
      start.headers.get("set-cookie"),
      /HttpOnly; Secure; SameSite=Lax/,
    );
    const callback =
      "/api/integrations/supabase/callback?code=isolated-code&state=" + state;
    let r = await nativeFetch(base + callback, { redirect: "manual" });
    assert.equal(r.headers.get("location"), "/connections?oauth=failed");
    assert.equal(exchanges, 0);
    r = await nativeFetch(base + callback, {
      headers: { cookie, "sec-fetch-site": "cross-site" },
      redirect: "manual",
    });
    assert.equal(r.headers.get("location"), "/connections?oauth=connected");
    assert.equal(exchanges, 1);
    const status = await (await request("/api/integrations")).json(),
      account = status.integrations.find((i) => i.id === "supabase");
    assert.equal(account.connected, true);
    assert.equal(account.toolCount, 1);
    assert.ok(!JSON.stringify(status).includes("isolated-secret"));
    await write("session:" + sessionId, {
      id: sessionId,
      workspace: "qa-oauth",
      status: "idle",
      events: [],
      messages: [],
      tools: [{ name: "document_read", builtin: true }],
      connected: {},
    });
    assert.equal(
      (await request("/api/sessions/" + sessionId + "/integrations", "POST"))
        .status,
      200,
    );
    const attached = await read("session:" + sessionId);
    assert.equal(attached.tools.length, 2);
    assert.equal(attached.tools[1].connectorId, "oauth-supabase");
    assert.ok(!JSON.stringify(attached).includes("isolated-secret-token"));
    const reference = decrypt(attached.connected["oauth-supabase"].config);
    assert.equal(reference.oauthProvider, "supabase");
    assert.equal(reference.token, undefined);
    await write("session:" + sessionId, { ...attached, status: "running" });
    assert.equal(
      (await request("/api/sessions/" + sessionId + "/integrations", "POST"))
        .status,
      409,
    );
    r = await nativeFetch(base + callback, {
      headers: { cookie },
      redirect: "manual",
    });
    assert.equal(r.headers.get("location"), "/connections?oauth=failed");
    assert.equal(exchanges, 1);
    const stored = decrypt(await read(keys[1]));
    stored.tokens.expiresAt = 1;
    await write(keys[1], encrypt(stored));
    await Promise.all([
      integrationConfig("supabase"),
      integrationConfig("supabase"),
    ]);
    assert.equal(
      exchanges,
      2,
      "Concurrent requests refresh once under DB lock",
    );
    assert.equal(
      (await request("/api/integrations/supabase/refresh", "POST")).status,
      200,
    );
    await request("/api/integrations/supabase", "DELETE");
    await assert.rejects(() => integrationConfig("supabase"), /disconnected/);
    await write("session:" + sessionId, { ...attached, status: "idle" });
    assert.equal(
      (await request("/api/sessions/" + sessionId + "/integrations", "POST"))
        .status,
      200,
    );
    assert.equal((await read("session:" + sessionId)).tools.length, 1);
    const denied = await request("/api/integrations/supabase/start", "POST"),
      deniedCookie = denied.headers.get("set-cookie").split(";")[0],
      deniedState = new URL((await denied.json()).url).searchParams.get(
        "state",
      );
    r = await nativeFetch(
      base +
        "/api/integrations/supabase/callback?error=access_denied&state=" +
        deniedState,
      { headers: { cookie: deniedCookie }, redirect: "manual" },
    );
    assert.equal(r.headers.get("location"), "/connections?oauth=denied");
    assert.equal(exchanges, 2);
    const cancelled = await request("/api/integrations/supabase/start", "POST");
    const cancelledCookie = cancelled.headers.get("set-cookie").split(";")[0];
    const cancelledState = new URL(
      (await cancelled.json()).url,
    ).searchParams.get("state");
    await request("/api/integrations/supabase", "DELETE");
    r = await nativeFetch(
      base +
        "/api/integrations/supabase/callback?code=cancelled&state=" +
        cancelledState,
      {
        headers: { cookie: cancelledCookie },
        redirect: "manual",
      },
    );
    assert.equal(r.headers.get("location"), "/connections?oauth=failed");
    assert.equal(
      exchanges,
      2,
      "Disconnect invalidates an in-flight OAuth consent",
    );
  },
);
