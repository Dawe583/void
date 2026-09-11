import { createHash } from "node:crypto";
import type { WorkspaceState } from "./workspace.ts";

export function page<T>(
  source: readonly T[],
  query: URLSearchParams,
  scope = "workspace",
) {
  const filter = [...query.entries()]
    .filter(([key]) => !["cursor", "limit"].includes(key))
    .sort()
    .toString();
  const signature = createHash("sha256")
    .update(filter)
    .digest("hex")
    .slice(0, 16);
  const identity = (row: T) => {
    const item = row as Record<string, unknown>;
    return String(item.id ?? item.holdId ?? item.seq ?? JSON.stringify(row));
  };
  let offset = 0;
  if (query.get("cursor")) {
    const cursor = JSON.parse(
      Buffer.from(query.get("cursor")!, "base64url").toString(),
    );
    if (cursor.filter !== signature || typeof cursor.last !== "string")
      throw new Error("Invalid cursor for this filter.");
    offset = source.findIndex((row) => identity(row) === cursor.last) + 1;
    if (!offset)
      throw new Error(
        "Cursor anchor is no longer available. Refresh the list.",
      );
  }
  const limit = Math.min(100, Math.max(1, Number(query.get("limit")) || 50));
  const items = source.slice(offset, offset + limit),
    hasMore = offset + limit < source.length;
  return {
    items,
    nextCursor: hasMore
      ? Buffer.from(
          JSON.stringify({ last: identity(items.at(-1)!), filter: signature }),
        ).toString("base64url")
      : null,
    hasMore,
    total: source.length,
    asOf: new Date().toISOString(),
    scope,
  };
}
export function sessionPatch(body: Record<string, unknown>) {
  const patch: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    project?: string;
    tags?: string[];
  } = {};
  for (const key of ["title", "project"] as const)
    if (key in body) {
      if (
        typeof body[key] !== "string" ||
        body[key].length > 160 ||
        !body[key].trim()
      )
        throw new Error(`Invalid ${key}.`);
      patch[key] = body[key].trim();
    }
  for (const key of ["pinned", "archived"] as const)
    if (key in body) {
      if (typeof body[key] !== "boolean") throw new Error(`Invalid ${key}.`);
      patch[key] = body[key];
    }
  if ("tags" in body) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.length > 20 ||
      !body.tags.every((tag) => typeof tag === "string" && tag.length <= 40)
    )
      throw new Error("Invalid tags.");
    patch.tags = body.tags as string[];
  }
  return patch;
}
export function preferencePatch(body: Record<string, unknown>) {
  const result: Record<string, string> = {};
  const enums: Record<string, string[]> = {
    locale: ["cs", "en"],
    appearance: ["system", "light", "dark"],
    sendBehavior: ["enter", "mod-enter"],
  };
  for (const key of [
    "defaultProvider",
    "defaultModel",
    "locale",
    "appearance",
    "sendBehavior",
  ])
    if (key in body) {
      const value = body[key];
      if (
        typeof value !== "string" ||
        !value.length ||
        value.length > 200 ||
        (enums[key] && !enums[key].includes(value))
      )
        throw new Error(`Invalid ${key}.`);
      result[key] = value;
    }
  return result;
}
export function documentView(
  state: WorkspaceState,
  path: string,
  sessionId: string,
) {
  const content = Object.hasOwn(state.files, path) ? state.files[path]! : null;
  const last = [...state.operations].reverse().find((op) => op.path === path);
  return {
    path,
    content,
    revision: last?.id ?? null,
    bytes: content === null ? 0 : Buffer.byteLength(content),
    updatedAt: last?.at ?? null,
    sessionId,
  };
}
export function filterRows<T>(rows: readonly T[], query: URLSearchParams): T[] {
  const q = (query.get("q") ?? "").toLowerCase();
  const result = rows.filter((row) => {
    const r = row as Record<string, unknown>;
    return (
      (!q || JSON.stringify(row).toLowerCase().includes(q)) &&
      [
        "status",
        "model",
        "workspace",
        "sessionId",
        "tool",
        "klass",
        "decision",
      ].every((key) => !query.get(key) || r[key] === query.get(key)) &&
      (!query.get("outcome") ||
        String(r.decision ?? "").replace(/^execute:/, "") ===
          query.get("outcome")) &&
      (!query.get("from") ||
        String(r.at ?? r.createdAt ?? "") >= query.get("from")!) &&
      (!query.get("to") ||
        String(r.at ?? r.createdAt ?? "") <= query.get("to")!)
    );
  });
  const sort = query.get("sort"),
    direction = query.get("order") === "asc" ? 1 : -1;
  if (sort && /^[A-Za-z][A-Za-z0-9]*$/.test(sort))
    result.sort((a, b) => {
      const x = (a as Record<string, unknown>)[sort],
        y = (b as Record<string, unknown>)[sort];
      return (
        direction *
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x ?? "").localeCompare(String(y ?? "")))
      );
    });
  return result;
}
export const capabilities = (mode: "local" | "cloud") => ({
  mode,
  maxActiveRuns: 1,
  streaming: true,
  branches: true,
  documentEditing: true,
  textAttachments: true,
  binaryAttachments: false,
  maxPromptCharacters: 32000,
  maxRequestBytes: 65536,
  historicalEvents: "retained-only",
});
export function activity(
  views: readonly {
    id: string;
    model: string;
    status: string;
    provider?: string;
    runId?: string;
    createdAt?: string;
    events: readonly {
      seq: number;
      at: string;
      kind: string;
      runId?: string;
      type?: string;
      payload?: Record<string, unknown>;
    }[];
  }[],
) {
  const runs = views.flatMap((s) => {
    const ids = [...new Set(s.events.map((e) => e.runId ?? `${s.id}:legacy`))];
    return ids.map((id) => {
      const events = s.events.filter(
        (e) => (e.runId ?? `${s.id}:legacy`) === id,
      );
      const first = events[0],
        last = events.at(-1);
      return {
        id,
        runId: id,
        sessionId: s.id,
        model: s.model,
        provider: s.provider,
        status:
          id === s.runId || !s.runId
            ? s.status
            : String(
                [...events].reverse().find((e) => e.type === "run.status")
                  ?.payload?.status ??
                  (events.some((e) => e.kind === "error")
                    ? "failed"
                    : "unknown"),
              ),
        createdAt: first?.at ?? s.createdAt,
        updatedAt: last?.at,
        durationMs:
          first && last ? Date.parse(last.at) - Date.parse(first.at) : null,
        steps: events.filter((e) => e.type === "tool.started").length,
        legacy: id.endsWith(":legacy"),
      };
    });
  });
  const usage = views.flatMap((s) =>
    s.events
      .filter((e) => e.kind === "usage")
      .map((e) => ({
        id: `${s.id}:${e.seq}`,
        sessionId: s.id,
        runId: e.runId,
        at: e.at,
        model: s.model,
        provider: s.provider,
        inputTokens:
          e.payload?.prompt_tokens ?? e.payload?.input_tokens ?? null,
        outputTokens:
          e.payload?.completion_tokens ?? e.payload?.output_tokens ?? null,
        totalTokens: e.payload?.total_tokens ?? null,
        cost: null,
        source: e.payload ? "provider" : "legacy-unavailable",
      })),
  );
  return {
    runs,
    usage,
    overview: {
      sessions: views.length,
      running: views.filter((s) => s.status === "running").length,
      failed: views.filter((s) => s.status === "failed").length,
      runs: runs.length,
      usageRecords: usage.length,
      totalTokens: usage.some((u) => typeof u.totalTokens === "number")
        ? usage.reduce(
            (sum, u) =>
              sum + (typeof u.totalTokens === "number" ? u.totalTokens : 0),
            0,
          )
        : null,
      cost: null,
      scope: "retained-history",
      asOf: new Date().toISOString(),
    },
  };
}
export function providerFailure(error: {
  status: number;
  code?: string;
  retryAfter?: number;
  message: string;
}) {
  const messages: Record<number, string> = {
    401: "Provider rejected the credential. Reconnect the provider.",
    403: "Provider denied access to this model or account.",
    404: "The selected model or provider endpoint is unavailable.",
    429: "Provider rate limit reached. Wait before sending another message.",
  };
  return {
    text: error.code
      ? error.message
      : (messages[error.status] ?? error.message),
    payload: {
      status: error.status,
      code: error.code ?? null,
      retryAfter: error.retryAfter ?? null,
      retryAt:
        error.retryAfter === undefined
          ? null
          : new Date(Date.now() + error.retryAfter * 1000).toISOString(),
      automaticRetry: false,
    },
  };
}

export function connectorInput(
  body: Record<string, unknown>,
  previous: Record<string, unknown> = {},
) {
  const result: {
    url: string;
    name?: string;
    token?: string;
    policy?: string;
    facts?: Record<string, boolean | string>;
    mapping?: Record<string, string>;
  } = { url: String(previous.url ?? "") };
  for (const key of ["url", "name", "token", "policy"] as const) {
    const value = body[key] ?? previous[key];
    if (value !== undefined) {
      if (
        typeof value !== "string" ||
        value.length > (key === "name" ? 80 : 16000)
      )
        throw new Error(`Invalid connector ${key}.`);
      result[key] =
        key === "token" && value === "" ? String(previous.token ?? "") : value;
    }
  }
  for (const key of ["facts", "mapping"] as const) {
    const value = body[key] ?? previous[key] ?? {};
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length > 200 ||
      Object.entries(value).some(
        ([k, v]) =>
          ["__proto__", "constructor", "prototype"].includes(k) ||
          k.length > 200 ||
          (typeof v !== "string" &&
            (key === "mapping" || typeof v !== "boolean")) ||
          (typeof v === "string" && v.length > 2000),
      )
    )
      throw new Error(`Invalid connector ${key}.`);
    if (key === "facts")
      result.facts = value as Record<string, boolean | string>;
    else result.mapping = value as Record<string, string>;
  }
  return result;
}
export function publicConnector(config: {
  id: string;
  name?: string;
  url?: string;
  token?: string;
  policy?: string;
  facts?: Record<string, boolean | string>;
  mapping?: Record<string, string>;
  tools: readonly { name: string }[];
}) {
  const result = {
    id: config.id,
    name: config.name,
    url: config.url,
    policy: config.policy,
    facts: config.facts ?? {},
    mapping: config.mapping ?? {},
    tools: config.tools.map((t) => t.name),
    toolDetails: config.tools,
    undo: false,
  };
  return config.token
    ? (JSON.parse(
        JSON.stringify(result).split(config.token).join("[redacted]"),
      ) as typeof result)
    : result;
}
