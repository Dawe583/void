/**
 * The registry query layer both HTTP shapes share.
 *
 * Kept separate from _registry.ts so the browser bundle can import the data and
 * the query helpers without dragging request parsing in with it.
 */

import {
  REGISTRY_DISCLAIMER,
  REGISTRY_VERSION,
  findEntry,
  isConditional,
  registry,
  registryStats,
  registryTags,
  registryVendors,
  searchRegistry,
  worstCase,
  type RegistryEntry,
  type RegistryTone,
} from "./_registry";

const TONES = new Set(["r0", "r1", "r2", "r3"]);
const MAX_LIMIT = 200;

export type RegistryParams = Record<string, string | string[] | undefined>;

function one(params: RegistryParams, key: string): string | undefined {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found === "" ? undefined : found;
}

function shape(entry: RegistryEntry) {
  return { ...entry, worstCase: worstCase(entry), conditional: isConditional(entry) };
}

export type RegistryResponse =
  | { status: 200; body: unknown }
  | { status: 400 | 404; body: { error: string; message: string } };

/**
 * One pure function, so the Vercel Function and the Express route cannot drift.
 * Views: stats for the facets, a single id, or a filtered page of entries.
 */
export function handleRegistry(params: RegistryParams): RegistryResponse {
  const view = one(params, "view");

  if (view === "stats") {
    return {
      status: 200,
      body: { ...registryStats(), vendors: registryVendors(), tags: registryTags() },
    };
  }

  const id = one(params, "id");
  if (id) {
    const entry = findEntry(id);
    if (!entry) {
      return { status: 404, body: { error: "not_found", message: `no registry entry with id ${id}` } };
    }
    return { status: 200, body: { version: REGISTRY_VERSION, entry: shape(entry), disclaimer: REGISTRY_DISCLAIMER } };
  }

  const tone = one(params, "tone");
  if (tone && !TONES.has(tone)) {
    return { status: 400, body: { error: "invalid_request", message: "tone must be one of r0, r1, r2, r3" } };
  }

  const rawLimit = Number.parseInt(one(params, "limit") ?? "", 10);
  const rawOffset = Number.parseInt(one(params, "offset") ?? "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : MAX_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const matched = searchRegistry({
    q: one(params, "q"),
    vendor: one(params, "vendor"),
    tag: one(params, "tag"),
    tone: tone as RegistryTone | undefined,
    conditionalOnly: one(params, "conditional") === "1",
  });

  return {
    status: 200,
    body: {
      version: REGISTRY_VERSION,
      total: registry.length,
      matched: matched.length,
      offset,
      limit,
      entries: matched.slice(offset, offset + limit).map(shape),
      disclaimer: REGISTRY_DISCLAIMER,
    },
  };
}

/** Parses a query string off a raw request URL, for runtimes that do not pre-parse it. */
export function paramsFromUrl(url: string | undefined): RegistryParams {
  const out: RegistryParams = {};
  const search = new URL(url ?? "/", "http://localhost").searchParams;
  for (const [key, value] of search.entries()) out[key] = value;
  return out;
}
