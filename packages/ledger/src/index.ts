/**
 * The append only ledger: hash chain, signing, verification.
 *
 * Nothing is implemented yet. WP-03 lands the canonicaliser, the two stores
 * (JSONL for the dev tier, Postgres for the hosted tier) and the verifier. What
 * is fixed here is the shape those get built against, because both parts are
 * expensive to change later: an interface with no mutation on it (decision 2)
 * and a signer that is asynchronous from the first line and never returns key
 * material (decision 3).
 */

/** Signature algorithms the stored format can carry. Not every KMS offers ed25519. */
export type Alg = "ed25519" | "ecdsa-p256-sha256";

/**
 * Async from the first line even though the first implementation is local:
 * every KMS is a network call, and turning a synchronous signature async later
 * is a change at every call site, made under production time pressure.
 *
 * There is deliberately no getPrivateKey and no exportKey. Exported key
 * material reaches a log or a crash dump eventually, so the unsafe call is not
 * available to write rather than merely discouraged.
 */
export interface KeyProvider {
  readonly alg: Alg;
  currentKeyId(): Promise<string>;
  sign(input: Uint8Array, keyId?: string): Promise<Uint8Array>;
  /** SPKI DER, or null when the key id is unknown to this provider. */
  publicKey(keyId: string): Promise<Uint8Array | null>;
}

/**
 * Four methods, and there will never be a fifth that mutates. Append only is
 * enforced first by the type system, then by Postgres grants, then by triggers,
 * then by the chain and the per entry signature. Only the last layer survives
 * an attacker who owns the database.
 *
 * The caller appends a body: the payload it wants on the record, carrying at
 * least a workspace string. The store adds the chain metadata, so what read
 * yields is the stored entry, the body plus seq, prev_hash, hash, key_id, alg
 * and signature. WP-03 sharpened the two type parameters accordingly: Body
 * is what the caller brings, StoredEntry is what the file holds, and the
 * verifier recomputes rather than trusts the stored metadata, which is the
 * difference between a check and a decoration.
 */
export interface LedgerStore<Body, StoredEntry, Receipt> {
  append(body: Body): Promise<Receipt>;
  read(workspace: string): AsyncIterable<StoredEntry>;
  head(workspace: string): Promise<Receipt | null>;
  verify(workspace: string): Promise<{ ok: boolean; checked: number; reason?: string }>;
}

/** Version tag in the signed preimage, so a format change cannot be replayed as the old one. */
export const LEDGER_PREIMAGE_VERSION = "void.ledger.v1";

const ENTRY_HASH = /^[0-9a-f]{64}$/;

/**
 * The bytes a signature covers: domain separated, versioned, and binding both
 * the algorithm and the key id, which is what defeats substitution and
 * downgrade replay. Signing the hash rather than the body keeps signature
 * checking independent of canonicalisation once a verifier has recomputed the
 * hash itself.
 *
 * The full 64 character digest, never the truncated display form. The prior art
 * in the split out site persisted 8 hex characters, which is birthday collidable in
 * roughly 65 thousand attempts and impossible to verify independently.
 */
export function signingPreimage(alg: Alg, keyId: string, entryHash: string): Uint8Array {
  if (!ENTRY_HASH.test(entryHash)) {
    throw new TypeError(`entry hash must be 64 lowercase hex characters, got ${JSON.stringify(entryHash)}`);
  }
  if (keyId.length === 0) {
    throw new TypeError("key id is required: a signature that cannot be attributed to a key is unverifiable after the first rotation");
  }
  return new TextEncoder().encode(`${LEDGER_PREIMAGE_VERSION}|${alg}|${keyId}|${entryHash}`);
}

export * from "./canonical.ts";
export * from "./sign.ts";
export * from "./store.ts";
