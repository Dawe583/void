/** Native Vercel REST adapter. Endpoint versions checked against
 * https://openapi.vercel.sh/ on 2026-09-11. Tokens never leave this origin.
 * These operations have no automatic inverse; the host governs write approval.
 */
const ORIGIN = "https://api.vercel.com";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const id = "[A-Za-z0-9_.-]+";
const route = (pattern, methods, query = []) => ({
  pattern: new RegExp(`^${pattern}$`),
  methods,
  query,
});
const routes = [
  route("/v(?:9|10)/projects", ["GET"], ["limit", "from", "search"]),
  route("/v11/projects", ["POST"]),
  route(`/v9/projects/${id}`, ["GET", "PATCH", "DELETE"]),
  route(
    "/v(?:6|7)/deployments",
    ["GET"],
    ["app", "projectId", "limit", "since", "until", "state", "target"],
  ),
  route(
    "/v13/deployments",
    ["POST"],
    ["forceNew", "skipAutoDetectionConfirmation"],
  ),
  route(`/v13/deployments/${id}`, ["GET", "DELETE"]),
  route(`/v12/deployments/${id}/cancel`, ["PATCH"]),
  route(
    `/v3/deployments/${id}/events`,
    ["GET"],
    ["direction", "limit", "name", "since", "until", "statusCode", "builds"],
  ),
  route(`/v9/projects/${id}/domains`, ["GET"], ["limit", "since", "until"]),
  route(`/v9/projects/${id}/domains/${id}`, ["GET", "PATCH", "DELETE"]),
  route(`/v10/projects/${id}/domains`, ["POST"]),
  route(
    `/v10/projects/${id}/env`,
    ["GET", "POST"],
    [
      "gitBranch",
      "source",
      "customEnvironmentId",
      "customEnvironmentSlug",
      "upsert",
    ],
  ),
  route(`/v9/projects/${id}/env/${id}`, ["PATCH", "DELETE"]),
];
const pathDescription =
  "Relative allowlisted REST path; no URL, query, encoding, or traversal. Reads: /v10/projects, /v9/projects/{id}, /v7/deployments, /v13/deployments/{id}, /v3/deployments/{id}/events, /v9/projects/{id}/domains[/{domain}], /v10/projects/{id}/env. Writes: POST /v11/projects or /v13/deployments; PATCH/DELETE /v9/projects/{id}; PATCH /v12/deployments/{id}/cancel; POST /v10/projects/{id}/domains or /v10/projects/{id}/env; PATCH/DELETE /v9/projects/{id}/domains/{domain} or /v9/projects/{id}/env/{envId}; DELETE /v13/deployments/{id}.";
const properties = {
  path: { type: "string", description: pathDescription },
  query: {
    type: "object",
    description:
      "Route-specific documented scalar filters. Team comes from the connected integration and cannot be overridden. Secret decryption and following log streams are unavailable.",
    additionalProperties: { type: ["string", "number", "boolean"] },
  },
};
const tools = [
  {
    name: "vercel_read",
    description:
      "Read Vercel projects, deployments, domains, environment variable metadata and bounded deployment events. GET only. Environment values are redacted. No mutations.",
    inputSchema: {
      type: "object",
      properties,
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "vercel_write",
    description:
      "Create, modify, cancel or delete allowlisted Vercel platform resources. Requires host policy approval. Changes may be irreversible; no automatic Undo and no automatic retry.",
    inputSchema: {
      type: "object",
      properties: {
        ...properties,
        method: { type: "string", enum: ["POST", "PATCH", "PUT", "DELETE"] },
        body: {
          description:
            "JSON request body accepted by the selected Vercel endpoint. Team/account selection cannot be overridden.",
          type: ["object", "array"],
        },
      },
      required: ["path", "method"],
      additionalProperties: false,
    },
  },
];
function failure(message, status, retryAfter) {
  return Object.assign(new Error(message), { status, retryAfter });
}
function credentials(config) {
  if (
    !config ||
    typeof config.token !== "string" ||
    !config.token ||
    config.token.length > 16384 ||
    /[\r\n]/.test(config.token)
  )
    throw failure("Connect a valid Vercel integration token.", 401);
  if (
    config.teamId !== undefined &&
    (typeof config.teamId !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(config.teamId))
  )
    throw failure("Invalid integration team ID.", 400);
}
function requestUrl(config, method, path, query) {
  if (
    typeof path !== "string" ||
    path.length > 600 ||
    /[%?#\\\s]/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw failure("Invalid Vercel resource path.", 400);
  const selected = routes.find(
    (r) => r.pattern.test(path) && r.methods.includes(method),
  );
  if (!selected)
    throw failure("This Vercel resource and method are not permitted.", 400);
  if (
    query !== undefined &&
    (!query || typeof query !== "object" || Array.isArray(query))
  )
    throw failure("Query must be a scalar filter object.", 400);
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (
      !selected.query.includes(key) ||
      !["string", "number", "boolean"].includes(typeof value) ||
      String(value).length > 1000 ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw failure("Unsupported Vercel query filter.", 400);
    if (
      key === "limit" &&
      (!Number.isInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > 100)
    )
      throw failure("Vercel page limit must be between 1 and 100.", 400);
    url.searchParams.set(key, String(value));
  }
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url;
}
const secretKey =
  /^(?:authorization|cookie|set-cookie|password|secret|client_secret|access_token|refresh_token|token|apiKey|privateKey|secretAccessKey)$/i;
function sanitize(value, secrets, redactValues = false) {
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets)
      if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]");
  }
  if (Array.isArray(value))
    return value.map((item) => sanitize(item, secrets, redactValues));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) || (redactValues && key === "value")
          ? "[redacted]"
          : sanitize(item, secrets, redactValues),
      ]),
    );
  return value;
}
function bodySecrets(value, found = []) {
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if ((secretKey.test(key) || key === "value") && typeof item === "string")
        found.push(item);
      else bodySecrets(item, found);
    }
  return found;
}
async function request(config, method, path, query, body) {
  credentials(config);
  const url = requestUrl(config, method, path, query);
  if (
    body !== undefined &&
    (method === "GET" || body === null || typeof body !== "object")
  )
    throw failure("Invalid JSON request body.", 400);
  if (
    body &&
    Object.keys(body).some((key) =>
      [
        "teamId",
        "team_id",
        "slug",
        "userId",
        "accountId",
        "ownerId",
        "transferToAccountId",
      ].includes(key),
    )
  )
    throw failure("Integration account selection cannot be overridden.", 400);
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && Buffer.byteLength(encoded) > MAX_BODY_BYTES)
    throw failure("Vercel request body exceeds 64 KB.", 413);
  let response;
  try {
    response = await (config.fetch ?? fetch)(url.href, {
      method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/json",
        ...(encoded ? { "content-type": "application/json" } : {}),
      },
      body: encoded,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw failure(
      "Vercel connection failed or timed out. No automatic retry was attempted.",
      502,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const raw = response.headers.get("retry-after"),
      retry = raw && /^\d{1,7}$/.test(raw) ? Number(raw) : undefined;
    throw failure(
      response.status === 401
        ? "Vercel rejected the integration token. Reconnect."
        : response.status === 403
          ? "Vercel denied access. Check integration scopes and team permissions."
          : response.status === 429
            ? "Vercel rate limit reached. Wait before retrying."
            : `Vercel request failed (HTTP ${response.status}). Inspect resource access before retrying.`,
      response.status,
      retry,
    );
  }
  let bytes = 0,
    text = "";
  const reader = response.body?.getReader(),
    decoder = new TextDecoder();
  try {
    if (reader)
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES)
          throw failure(
            "Vercel response exceeds 1 MB. Use narrower filters.",
            413,
          );
        text += decoder.decode(chunk.value, { stream: true });
      }
    text += decoder.decode();
  } catch (error) {
    if (error.status) throw error;
    throw failure(
      "Vercel response was interrupted. Inspect the resource before retrying.",
      502,
    );
  } finally {
    await reader?.cancel().catch(() => {});
  }
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  return sanitize(
    value,
    [config.token, ...bodySecrets(body)],
    /\/env(?:\/|$)/.test(path),
  );
}
export async function vercelCatalog(config) {
  const result = await request(config, "GET", "/v9/projects", { limit: 1 });
  if (!result || !Array.isArray(result.projects))
    throw failure("Vercel did not return a valid projects catalog.", 502);
  return { tools: structuredClone(tools), teamId: config.teamId ?? null };
}
export async function vercelCall(config, name, args) {
  try {
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      !["vercel_read", "vercel_write"].includes(name)
    )
      throw failure("Invalid Vercel tool request.", 400);
    const allowed =
      name === "vercel_read"
        ? ["path", "query"]
        : ["path", "query", "method", "body"];
    if (Object.keys(args).some((key) => !allowed.includes(key)))
      throw failure("Unsupported Vercel tool argument.", 400);
    const method = name === "vercel_read" ? "GET" : args.method;
    if (
      name === "vercel_write" &&
      !["POST", "PATCH", "PUT", "DELETE"].includes(method)
    )
      throw failure("Choose a supported write method.", 400);
    const data = await request(
      config,
      method,
      args.path,
      args.query,
      args.body,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            data,
            teamId: config.teamId ?? null,
            undo: false,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "vercel_request_failed",
            message: error.status ? error.message : "Invalid Vercel request.",
            status: error.status ?? 400,
            retryAfter: error.retryAfter ?? null,
            automaticRetry: false,
          }),
        },
      ],
    };
  }
}
