import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, GENESIS_PREV } from "./canonical.ts";
import { devKeyProvider, sha256Hex, verifySignature } from "./sign.ts";
import type { Alg, KeyProvider } from "./index.ts";
import { readLedgerEntries, verifyChain, type PublicKeyLookup } from "./verify.ts";
import type { JsonlEntry } from "./store.ts";

export type AttestationDocument = {
  readonly workspace: string;
  readonly headSeq: number;
  readonly headHash: string;
  readonly at: string;
  readonly entriesCount: number;
  readonly treeDigest: string;
  readonly key_id: string;
  readonly alg: Alg;
  readonly signature: string;
};

export type VerifyAttestationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type AttestLedgerOptions = {
  readonly now?: () => Date;
};

const ATTESTATION_PREIMAGE_VERSION = "void.ledger.attestation.v1";
const MERKLE_DOMAIN = "void.ledger.merkle.v1";

export async function attestLedger(
  dir: string,
  workspace: string,
  key?: KeyProvider,
  options: AttestLedgerOptions = {},
): Promise<AttestationDocument> {
  const signer = key ?? await devKeyProvider();
  const file = join(dir, `${workspace}.jsonl`);
  const entries = await readLedgerEntries(file);
  const verified = await verifyChain(entries, { publicKey: (keyId) => signer.publicKey(keyId) });
  if (!verified.ok) throw new Error(`cannot attest invalid ledger: ${verified.reason}`);
  const keyId = await signer.currentKeyId();
  const unsigned = {
    workspace,
    headSeq: entries.length === 0 ? 0 : entries[entries.length - 1]!.seq,
    headHash: verified.head,
    at: (options.now ?? (() => new Date()))().toISOString(),
    entriesCount: entries.length,
    treeDigest: await merkleDigest(entries.map((entry) => entry.hash)),
    key_id: keyId,
    alg: signer.alg,
  };
  const signature = await signer.sign(attestationPreimage(unsigned), keyId);
  return { ...unsigned, signature: `${signer.alg}:${Buffer.from(signature).toString("base64")}` };
}

export async function storeAttestation(dir: string, doc: AttestationDocument): Promise<string> {
  const attestations = join(dir, "attestations");
  await mkdir(attestations, { recursive: true, mode: 0o700 });
  const path = join(attestations, `${doc.headSeq}.json`);
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(doc, null, 2)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

export async function verifyAttestation(
  doc: AttestationDocument,
  ledgerEntries: readonly JsonlEntry[],
  options: { readonly publicKey: PublicKeyLookup },
): Promise<VerifyAttestationResult> {
  const chain = await verifyChain(ledgerEntries);
  if (!chain.ok) return { ok: false, reason: `ledger mismatch: ${chain.reason}` };
  if (doc.entriesCount !== ledgerEntries.length)
    return { ok: false, reason: `entries count mismatch: attestation ${doc.entriesCount}, ledger ${ledgerEntries.length}` };
  const headSeq = ledgerEntries.length === 0 ? 0 : ledgerEntries[ledgerEntries.length - 1]!.seq;
  if (doc.headSeq !== headSeq)
    return { ok: false, reason: `head seq mismatch: attestation ${doc.headSeq}, ledger ${headSeq}` };
  if (doc.headHash !== chain.head)
    return { ok: false, reason: `head hash mismatch: attestation ${doc.headHash}, ledger ${chain.head}` };
  const treeDigest = await merkleDigest(ledgerEntries.map((entry) => entry.hash));
  if (doc.treeDigest !== treeDigest)
    return { ok: false, reason: `tree digest mismatch: attestation ${doc.treeDigest}, ledger ${treeDigest}` };
  const wrongWorkspace = ledgerEntries.find((entry) => entry.workspace !== doc.workspace);
  if (wrongWorkspace !== undefined)
    return { ok: false, reason: `workspace mismatch at entry ${wrongWorkspace.seq}` };
  if (doc.alg !== "ed25519")
    return { ok: false, reason: `unsupported attestation algorithm ${doc.alg}` };
  const signature = attestationSignatureBytes(doc);
  if (signature === null)
    return { ok: false, reason: "malformed attestation signature" };
  const publicKey = await lookupAttestationKey(options.publicKey, doc.key_id);
  if (publicKey === null)
    return { ok: false, reason: `no public key for attestation key ${doc.key_id}` };
  const ok = verifySignature(
    "ed25519",
    attestationPreimage(unsignedAttestation(doc)),
    signature,
    publicKey,
  );
  return ok ? { ok: true } : { ok: false, reason: `attestation signature fails under ${doc.key_id}` };
}

export async function merkleDigest(hashes: readonly string[]): Promise<string> {
  if (hashes.length === 0) return sha256Hex(`${MERKLE_DOMAIN}|empty`);
  let level = [...hashes];
  for (const hash of level) assertDigest(hash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(await sha256Hex(`${MERKLE_DOMAIN}|node|${left}|${right}`));
    }
    level = next;
  }
  return level[0] ?? GENESIS_PREV;
}

function unsignedAttestation(doc: AttestationDocument): Omit<AttestationDocument, "signature"> {
  return {
    workspace: doc.workspace,
    headSeq: doc.headSeq,
    headHash: doc.headHash,
    at: doc.at,
    entriesCount: doc.entriesCount,
    treeDigest: doc.treeDigest,
    key_id: doc.key_id,
    alg: doc.alg,
  };
}

function attestationPreimage(doc: Omit<AttestationDocument, "signature">): Uint8Array {
  return new TextEncoder().encode(`${ATTESTATION_PREIMAGE_VERSION}|${canonicalJson(doc)}`);
}

function attestationSignatureBytes(doc: AttestationDocument): Uint8Array | null {
  const [alg, encoded, extra] = doc.signature.split(":");
  if (extra !== undefined || alg !== doc.alg || encoded === undefined || encoded === "")
    return null;
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

async function lookupAttestationKey(
  lookup: PublicKeyLookup,
  keyId: string,
): Promise<Uint8Array | null> {
  if (lookup instanceof Uint8Array) return lookup;
  return lookup(keyId);
}

function assertDigest(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash))
    throw new TypeError(`merkle input must be a 64 lowercase hex digest, got ${JSON.stringify(hash)}`);
}
