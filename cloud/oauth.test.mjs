import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  authorization,
  validateCallback,
  hash,
  exchange,
  integrationClass,
  PROVIDERS,
} from "./oauth.mjs";

test("OAuth uses random state and browser binding; supported providers use S256", () => {
  for (const id of Object.keys(PROVIDERS)) {
    const a = authorization(
      id,
      {
        client_id: "public-id",
        client_secret: "must-not-leak",
        integration_slug: "void-agent-tools",
      },
      "https://void-tui.vercel.app/api/integrations/" + id + "/callback",
    );
    const b = authorization(
        id,
        { client_id: "public-id", integration_slug: "void-agent-tools" },
        a.callback,
      ),
      u = new URL(a.url);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.binding, b.binding);
    assert.equal(a.state.length, 43);
    if (id !== "vercel") {
      assert.equal(
        u.searchParams.get("code_challenge"),
        createHash("sha256").update(a.verifier).digest("base64url"),
      );
      assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    } else {
      assert.equal(u.pathname, "/integrations/void-agent-tools/new");
      assert.equal(u.searchParams.get("code_challenge"), null);
    }
    assert.ok(!a.url.includes("must-not-leak"));
    assert.ok(!a.url.includes(a.verifier));
    const p = {
      provider: id,
      bindingHash: hash(a.binding),
      epoch: "key-generation",
      expiresAt: Date.now() + 1000,
    };
    validateCallback(p, id, a.binding, "key-generation");
    for (const q of [
      { ...p, used: true },
      { ...p, expiresAt: 0 },
      { ...p, provider: "attacker" },
      { ...p, epoch: "rotated" },
      null,
    ])
      assert.throws(() => validateCallback(q, id, a.binding, "key-generation"));
    assert.throws(() =>
      validateCallback(p, id, "other-browser", "key-generation"),
    );
  }
  assert.throws(() => authorization("__proto__", {}, ""));
  assert.throws(() => authorization("https://evil.test", {}, ""));
});
test("token exchange uses Basic for Supabase and body secret for GitHub; never redirects", async () => {
  for (const id of ["supabase", "github", "vercel"]) {
    const value = await exchange(
      id,
      { client_id: "id", client_secret: "secret" },
      {
        grant_type: "authorization_code",
        code: "code",
        code_verifier: "verifier",
      },
      async (url, init) => {
        assert.equal(url, PROVIDERS[id].token);
        assert.equal(init.redirect, "error");
        assert.equal(
          init.body.get("code_verifier"),
          id === "vercel" ? null : "verifier",
        );
        if (id === "supabase") {
          assert.equal(
            init.headers.authorization,
            "Basic " + Buffer.from("id:secret").toString("base64"),
          );
          assert.equal(init.body.get("client_secret"), null);
        } else assert.equal(init.body.get("client_secret"), "secret");
        return Response.json({
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      },
    );
    assert.equal(value.access_token, "token");
    assert.ok(value.expiresAt > Date.now());
  }
});
test("OAuth errors are redacted and malformed or wrong-type tokens rejected", async () => {
  for (const body of [
    { error: "secret-token" },
    { access_token: "" },
    { access_token: "x", token_type: "mac" },
  ])
    await assert.rejects(
      () =>
        exchange("github", { client_id: "x" }, {}, async () =>
          Response.json(body),
        ),
      (e) => !e.message.includes("secret-token"),
    );
  await assert.rejects(() =>
    exchange(
      "github",
      { client_id: "x" },
      {},
      async () => new Response("invalid"),
    ),
  );
});
test("remote writes and multi-operation tools require r3 approval, never inferred reversible", () => {
  assert.equal(integrationClass("github", "get_me"), "r0");
  assert.equal(integrationClass("vercel", "vercel_read"), "r0");
  assert.equal(integrationClass("vercel", "vercel_write"), "r3");
  assert.equal(integrationClass("supabase", "list_tables"), "r0");
  for (const [id, names] of Object.entries({
    github: [
      "create_or_update_file",
      "issue_write",
      "run_code",
      "get_and_delete",
    ],
    vercel: ["deploy_to_vercel", "delete_project"],
    supabase: ["execute_sql", "apply_migration", "delete_branch"],
  }))
    for (const name of names) assert.equal(integrationClass(id, name), "r3");
});
