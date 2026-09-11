import test from "node:test";
import assert from "node:assert/strict";
import { vercelCatalog, vercelCall } from "./vercel-integration.mjs";
const token = "private-oauth-access-token";
const config = (fetch) => ({ token, teamId: "team_isolated", fetch });
const payload = (result) => JSON.parse(result.content[0].text);

test("catalog validates live projects access, pinned team and authorization", async () => {
  let calls = 0;
  const result = await vercelCatalog(
    config(async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://api.vercel.com/v9/projects?limit=1&teamId=team_isolated",
      );
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return Response.json({ projects: [] });
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.teamId, "team_isolated");
  assert.deepEqual(
    result.tools.map((t) => t.name),
    ["vercel_read", "vercel_write"],
  );
  await assert.rejects(
    vercelCatalog(config(async () => Response.json({ user: {} }))),
    /catalog/,
  );
});

test("paths cannot escape origin or reach identity, tokens, decryption or mutate with read", async () => {
  let calls = 0;
  const c = config(async () => {
    calls++;
    return Response.json({});
  });
  for (const path of [
    "https://evil.test/v9/projects",
    "//evil.test/v9/projects",
    "/v9/projects/../tokens",
    "/v9/projects/%2e%2e/tokens",
    "/v9/projects?teamId=other",
    "/v9/projects#fragment",
    "/v9/projects\\other",
    "/v2/user",
    "/v3/user/tokens",
    "/v1/projects/p/env/secret",
  ])
    assert.equal(
      (await vercelCall(c, "vercel_read", { path })).isError,
      true,
      path,
    );
  for (const query of [
    { teamId: "other" },
    { slug: "other" },
    { decrypt: true },
    { follow: 1 },
    { limit: 101 },
  ])
    assert.equal(
      (
        await vercelCall(c, "vercel_read", {
          path: "/v10/projects/p/env",
          query,
        })
      ).isError,
      true,
    );
  assert.equal(
    (
      await vercelCall(c, "vercel_read", {
        path: "/v9/projects/p",
        method: "DELETE",
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await vercelCall(c, "vercel_write", {
        path: "/v9/projects",
        method: "GET",
      })
    ).isError,
    true,
  );
  assert.equal(calls, 0);
});

test("approved host write is a single fixed REST call; team override refused", async () => {
  let calls = 0;
  const c = config(async (url, options) => {
    calls++;
    assert.equal(
      url,
      "https://api.vercel.com/v11/projects?teamId=team_isolated",
    );
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { name: "fixture-app" });
    return Response.json({ id: "fixture" });
  });
  const result = await vercelCall(c, "vercel_write", {
    method: "POST",
    path: "/v11/projects",
    body: { name: "fixture-app" },
  });
  assert.equal(result.isError, undefined);
  assert.equal(payload(result).undo, false);
  assert.equal(calls, 1);
  assert.equal(
    (
      await vercelCall(c, "vercel_write", {
        method: "POST",
        path: "/v11/projects",
        body: { name: "fixture", teamId: "other" },
      })
    ).isError,
    true,
  );
  assert.equal(calls, 1);
});

test("success and errors redact credentials and environment values", async () => {
  const result = await vercelCall(
    config(async () =>
      Response.json({
        envs: [{ key: "API_KEY", value: "private-env-value" }],
        token,
        log: `authorization: Bearer ${token}`,
      }),
    ),
    "vercel_read",
    { path: "/v10/projects/p/env" },
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-oauth|private-env-value/,
  );
  assert.equal(payload(result).data.envs[0].key, "API_KEY");
  let calls = 0;
  const error = await vercelCall(
    config(async () => {
      calls++;
      return new Response("upstream-private-secret", {
        status: 429,
        headers: { "retry-after": "9" },
      });
    }),
    "vercel_write",
    { method: "DELETE", path: "/v9/projects/p" },
  );
  assert.equal(error.isError, true);
  assert.equal(payload(error).retryAfter, 9);
  assert.equal(payload(error).automaticRetry, false);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(error), /upstream-private/);
});

test("response and body bounds refuse; interrupted transport never retries", async () => {
  let calls = 0;
  const c = config(async () => {
    calls++;
    return new Response("x".repeat(1024 * 1024 + 1));
  });
  assert.equal(
    payload(await vercelCall(c, "vercel_read", { path: "/v9/projects" }))
      .status,
    413,
  );
  assert.equal(
    payload(
      await vercelCall(c, "vercel_write", {
        method: "POST",
        path: "/v11/projects",
        body: { name: "x".repeat(65537) },
      }),
    ).status,
    413,
  );
  assert.equal(calls, 1);
  const failure = await vercelCall(
    config(async () => {
      throw new Error(token);
    }),
    "vercel_read",
    { path: "/v9/projects" },
  );
  assert.equal(payload(failure).status, 502);
  assert.doesNotMatch(JSON.stringify(failure), /private-oauth/);
});
