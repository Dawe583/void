import { createHash, randomBytes } from "node:crypto";

// Fixed providers only: metadata and token destinations never come from a browser.
export const PROVIDERS = Object.freeze({
  github: {
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "repo read:org read:user",
    authMethod: "client_secret_post",
    description:
      "Repositories, code, issues and pull requests through GitHub MCP.",
  },
  vercel: {
    name: "Vercel",
    url: "https://api.vercel.com/",
    authorize: "https://vercel.com/integrations/",
    token: "https://api.vercel.com/v2/oauth/access_token",
    scope: "",
    authMethod: "client_secret_post",
    description:
      "Projects, deployments, domains and logs through Vercel integration OAuth.",
  },
  supabase: {
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    authorize: "https://api.supabase.com/v1/oauth/authorize",
    token: "https://api.supabase.com/v1/oauth/token",
    scope:
      "organizations:read projects:read projects:write database:read database:write analytics:read secrets:read edge_functions:read edge_functions:write environment:read environment:write storage:read storage:write",
    authMethod: "client_secret_basic",
    description:
      "Projects, database, migrations, logs and functions through Supabase MCP.",
  },
});
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const nonce = () => randomBytes(32).toString("base64url");
export function providerDefinition(id) {
  if (!Object.hasOwn(PROVIDERS, id))
    throw Object.assign(new Error("Unknown integration."), { status: 404 });
  return PROVIDERS[id];
}
export function authorization(id, client, callback) {
  const spec = providerDefinition(id),
    state = nonce(),
    verifier = nonce(),
    binding = nonce();
  const url = new URL(spec.authorize);
  if (id === "vercel") {
    if (!/^[a-z0-9-]{1,80}$/.test(client.integration_slug ?? ""))
      throw Object.assign(
        new Error("Register a Vercel connectable integration and its slug."),
        { status: 409 },
      );
    url.pathname += client.integration_slug + "/new";
  }
  const params = {
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: "code",
    scope: spec.scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  };
  if (id === "supabase") params.resource = spec.url;
  // Vercel integration OAuth uses state and a confidential client, without PKCE.
  if (id === "vercel") {
    for (const key of Object.keys(params))
      if (key !== "state") delete params[key];
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    state,
    verifier,
    binding,
    url: url.href,
    callback,
    expiresAt: Date.now() + 600000,
  };
}
export function validateCallback(
  pending,
  id,
  binding,
  epoch,
  now = Date.now(),
) {
  if (
    !pending ||
    pending.provider !== id ||
    pending.used ||
    pending.expiresAt <= now ||
    !binding ||
    pending.bindingHash !== hash(binding) ||
    pending.epoch !== epoch
  )
    throw Object.assign(
      new Error(
        "OAuth request expired or belongs to another browser. Start again.",
      ),
      { status: 400 },
    );
}
export async function exchange(id, client, grant, fetcher = fetch) {
  const spec = providerDefinition(id),
    body = new URLSearchParams({ client_id: client.client_id, ...grant });
  if (id === "vercel") {
    body.delete("code_verifier");
    body.delete("grant_type");
  }
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (spec.authMethod === "client_secret_basic")
    headers.authorization =
      "Basic " +
      Buffer.from(client.client_id + ":" + client.client_secret).toString(
        "base64",
      );
  else if (client.client_secret)
    body.set("client_secret", client.client_secret);
  const response = await fetcher(spec.token, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (text.length > 65536) throw new Error("OAuth response too large.");
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("OAuth provider returned an invalid response.");
  }
  if (
    !response.ok ||
    result.error ||
    typeof result.access_token !== "string" ||
    !result.access_token ||
    (result.token_type && result.token_type.toLowerCase() !== "bearer")
  )
    throw Object.assign(
      new Error("OAuth exchange rejected. Reconnect the integration."),
      { status: 401 },
    );
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    scope: result.scope ?? spec.scope,
    ...(id === "vercel"
      ? { teamId: result.team_id, installationId: result.installation_id }
      : {}),
    expiresAt:
      Number(result.expires_in) > 0
        ? Date.now() + Number(result.expires_in) * 1000
        : null,
  };
}
// Exact read allowlists. Tool annotations and names alone cannot authorize writes.
const READ_TOOLS = {
  github: new Set([
    "get_me",
    "get_file_contents",
    "get_commit",
    "list_commits",
    "list_branches",
    "list_tags",
    "get_tag",
    "get_release_by_tag",
    "get_latest_release",
    "list_releases",
    "search_repositories",
    "search_code",
    "search_issues",
    "search_pull_requests",
    "search_users",
    "list_issues",
    "list_pull_requests",
  ]),
  vercel: new Set([
    "vercel_read",
    "list_teams",
    "list_projects",
    "get_project",
    "list_deployments",
    "get_deployment",
    "get_deployment_build_logs",
    "get_runtime_logs",
    "search_vercel_documentation",
  ]),
  supabase: new Set([
    "list_projects",
    "get_project",
    "list_organizations",
    "get_organization",
    "list_tables",
    "list_extensions",
    "list_migrations",
    "get_logs",
    "get_advisors",
    "get_project_url",
    "get_publishable_keys",
    "generate_typescript_types",
    "list_edge_functions",
    "get_edge_function",
    "list_branches",
    "list_storage_buckets",
    "get_storage_config",
    "search_docs",
  ]),
};
export function integrationClass(id, name) {
  providerDefinition(id);
  return READ_TOOLS[id].has(name) ? "r0" : "r3";
}
