import { readFile } from "node:fs/promises";

import { GENESIS_PREV, entryHash } from "./canonical.ts";
import { sha256Hex, verifySignature } from "./sign.ts";
import { signingPreimage } from "./index.ts";
import type { JsonlEntry } from "./store.ts";

export type PublicKeyLookup =
  | Uint8Array
  | ((keyId: string) => Promise<Uint8Array | null> | Uint8Array | null);

export type VerifyChainLine = {
  readonly seq: number;
  readonly ok: boolean;
  readonly reason?: string;
};

export type VerifyChainResult = {
  readonly ok: boolean;
  readonly checked: number;
  readonly head: string;
  readonly lines: readonly VerifyChainLine[];
  readonly reason?: string;
};

export type VerifyChainOptions = {
  readonly publicKey?: PublicKeyLookup;
};

export type VerifyLedgerFileOptions = VerifyChainOptions;

export async function verifyLedgerFile(
  path: string,
  options: VerifyLedgerFileOptions = {},
): Promise<VerifyChainResult> {
  return verifyChain(await readLedgerEntries(path), options);
}

export async function verifyChain(
  entries: readonly JsonlEntry[],
  options: VerifyChainOptions = {},
): Promise<VerifyChainResult> {
  let prev = GENESIS_PREV;
  let checked = 0;
  const lines: VerifyChainLine[] = [];

  for (const entry of entries) {
    checked += 1;
    const fail = (reason: string): VerifyChainResult => {
      lines.push({ seq: entry.seq, ok: false, reason });
      return { ok: false, checked, head: prev, lines, reason };
    };

    if (entry.seq !== checked)
      return fail(`expected seq ${checked}, found ${entry.seq}`);
    if (entry.prev_hash !== prev)
      return fail(`entry ${entry.seq} points at ${entry.prev_hash}, expected ${prev}`);
    const recomputed = await entryHash(entry.body, prev, sha256Hex);
    if (recomputed !== entry.hash)
      return fail(`entry ${entry.seq} body does not match digest`);

    if (options.publicKey !== undefined) {
      if (entry.alg !== "ed25519")
        return fail(`entry ${entry.seq} carries unsupported algorithm ${entry.alg}`);
      const signature = signatureBytes(entry);
      if (signature === null)
        return fail(`entry ${entry.seq} carries a malformed signature tag`);
      const publicKey = await lookupPublicKey(options.publicKey, entry.key_id);
      if (publicKey === null)
        return fail(`entry ${entry.seq} has no public key for ${entry.key_id}`);
      const ok = verifySignature(
        "ed25519",
        signingPreimage("ed25519", entry.key_id, entry.hash),
        signature,
        publicKey,
      );
      if (!ok)
        return fail(`entry ${entry.seq} fails signature verification under ${entry.key_id}`);
    }

    lines.push({ seq: entry.seq, ok: true });
    prev = entry.hash;
  }

  return { ok: true, checked, head: prev, lines };
}

export async function readLedgerEntries(path: string): Promise<JsonlEntry[]> {
  const text = await readFile(path, "utf8");
  const entries: JsonlEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`ledger line ${index + 1} is not JSON`);
    }
    entries.push(asEntry(parsed, index + 1));
  }
  return entries;
}

async function lookupPublicKey(
  lookup: PublicKeyLookup,
  keyId: string,
): Promise<Uint8Array | null> {
  if (lookup instanceof Uint8Array) return lookup;
  return lookup(keyId);
}

function signatureBytes(entry: JsonlEntry): Uint8Array | null {
  const [alg, encoded, extra] = entry.signature.split(":");
  if (extra !== undefined || alg !== entry.alg || encoded === undefined || encoded === "")
    return null;
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

function asEntry(value: unknown, line: number): JsonlEntry {
  if (typeof value !== "object" || value === null)
    throw new Error(`ledger line ${line} is not an object`);
  const entry = value as Partial<JsonlEntry>;
  if (typeof entry.workspace !== "string" || entry.workspace === "")
    throw new Error(`ledger line ${line} has invalid workspace`);
  if (typeof entry.seq !== "number" || !Number.isInteger(entry.seq) || entry.seq < 1)
    throw new Error(`ledger line ${line} has invalid seq`);
  if (typeof entry.body !== "object" || entry.body === null)
    throw new Error(`ledger line ${line} has invalid body`);
  if (typeof entry.prev_hash !== "string" || typeof entry.hash !== "string")
    throw new Error(`ledger line ${line} has invalid chain digests`);
  if (typeof entry.key_id !== "string" || entry.key_id === "")
    throw new Error(`ledger line ${line} has invalid key id`);
  if (typeof entry.alg !== "string" || entry.alg === "")
    throw new Error(`ledger line ${line} has invalid algorithm`);
  if (typeof entry.signature !== "string" || entry.signature === "")
    throw new Error(`ledger line ${line} has invalid signature`);
  return entry as JsonlEntry;
}
