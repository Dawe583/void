/**
 * Canonical JSON and the entry hash.
 *
 * Deliberately recursive. The prior art in the split out site's `_core.ts`
 * passed a replacer allowlist computed from top level keys, which
 * JSON.stringify then applied at every depth, so every nested value was
 * erased from the preimage while the entry still looked sealed. Tool call
 * arguments, snapshot descriptors and policy decisions are all nested by
 * nature, so the first real entry would have been unauthenticated.
 *
 * Canonical form: object keys sorted at every depth, no insignificant
 * whitespace, numbers in their shortest round tripping form. Two runtimes
 * hashing the same entry must agree byte for byte, which is what makes an
 * offline verifier possible at WP-13.
 */

const SORTED_PAIRS = (a: [string, unknown], b: [string, unknown]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

/**
 * Depth ceiling for the recursive canonicaliser. A stack overflow would be a
 * RangeError with a V8 frame dump rather than a refusal with a name, and the
 * write path must fail with a message the caller can act on. Real intercepted
 * call bodies sit two or three levels deep; a thousand is already hostile.
 */
const MAX_DEPTH = 1000;

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new WeakSet(), 0);
}

/**
 * The seen set breaks reference cycles. A cycle in a tool argument would
 * otherwise recurse until the call stack dies and take the write path with
 * it, and the failure mode of a ledger in the write path must be a refusal
 * with a name, not a crash.
 */
function canonicalize(value: unknown, seen: WeakSet<object>, depth: number): string {
  if (depth > MAX_DEPTH)
    throw new TypeError("ledger payload nests deeper than 1000 levels");
  if (value === null) return "null";
  switch (typeof value) {
    case "undefined":
      throw new TypeError("undefined does not round trip through JSON");
    case "number":
      if (!Number.isFinite(value))
        throw new TypeError(`${String(value)} does not round trip through JSON`);
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "bigint":
      throw new TypeError("bigint does not round trip through JSON");
    case "function":
    case "symbol":
      throw new TypeError(`${typeof value} does not round trip through JSON`);
    case "object": {
      if (seen.has(value as object))
        throw new TypeError("reference cycle in ledger payload");
      seen.add(value as object);
      try {
        if (Array.isArray(value))
          return `[${value.map((item) => canonicalize(item, seen, depth + 1)).join(",")}]`;
        const entries = Object.entries(value as Record<string, unknown>);
        entries.sort(SORTED_PAIRS);
        return `{${entries
          .map(
            ([key, item]) =>
              `${canonicalize(key, seen, depth + 1)}:${canonicalize(item, seen, depth + 1)}`,
          )
          .join(",")}}`;
      } finally {
        seen.delete(value as object);
      }
    }
  }
  // Unreachable for values that passed typeof, and the type checker needs to
  // hear it: a canonicaliser that quietly returned undefined would hash the
  // string "undefined" into a chain entry that no other runtime can rebuild.
  throw new TypeError(`${typeof value} is not a JSON value`);
}

/**
 * The entry digest is sha256 over the canonical JSON of the body plus the
 * previous entry's full 64 character digest, domain separated with the
 * preimage version so a chain entry cannot be replayed as a different
 * format's entry. The digest is returned full length; truncation happens
 * only at a render boundary, never in the chain.
 */
export const ENTRY_DOMAIN = "void.ledger.entry.v1";

export async function entryHash(
  body: unknown,
  prevHash: string,
  sha256: (input: string) => Promise<string>,
): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(prevHash))
    throw new TypeError(
      `previous hash must be 64 lowercase hex characters, got ${JSON.stringify(prevHash)}`,
    );
  return sha256(`${ENTRY_DOMAIN}|${prevHash}|${canonicalJson(body)}`);
}

/** The digest of the very first entry's predecessor: the domain, all zeroes. */
export const GENESIS_PREV = "0".repeat(64);
