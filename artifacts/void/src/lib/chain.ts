/**
 * Hash chain helpers for the attestation verifier.
 *
 * This is the real algorithm, not a mock: the same canonical form and the same
 * sha256(prev | body) link that api/_core.ts seals form receipts with. The page
 * recomputes every link in the visitor's own browser using Web Crypto, so the
 * "verified" badge is something the visitor proved rather than something we
 * asserted.
 */

import type { Tone } from "@/lib/site-data";

export type ChainEntry = {
  seq: number;
  time: string;
  agent: string;
  tool: string;
  klass: Tone;
  system: string;
  target: string;
  decision: "allow" | "hold" | "approved" | "vetoed";
  payloadDigest: string;
  prevHash: string | null;
  hash: string;
};

export type LinkVerdict = {
  seq: number;
  /** The hash the entry claims. */
  claimed: string;
  /** The hash its contents actually produce. */
  computed: string;
  /** Contents match the recorded hash. */
  bodyOk: boolean;
  /** prevHash points at the previous entry's recorded hash. */
  linkOk: boolean;
};

export function chainSupported(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function";
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Key order must not change the hash, so the body is serialised with sorted keys. */
function canonical(entry: Omit<ChainEntry, "hash">): string {
  const body: Record<string, unknown> = {
    seq: entry.seq,
    time: entry.time,
    agent: entry.agent,
    tool: entry.tool,
    class: entry.klass,
    system: entry.system,
    target: entry.target,
    decision: entry.decision,
    payloadDigest: entry.payloadDigest,
  };
  return JSON.stringify(body, Object.keys(body).sort());
}

export async function linkHash(entry: Omit<ChainEntry, "hash">): Promise<string> {
  return sha256Hex(`${entry.prevHash ?? "genesis"}|${canonical(entry)}`);
}

/** Recomputes every link and reports where, if anywhere, the chain stops holding. */
export async function verifyChain(entries: ChainEntry[]): Promise<LinkVerdict[]> {
  const verdicts: LinkVerdict[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const computed = await linkHash(entry);
    const expectedPrev = index === 0 ? null : entries[index - 1].hash;

    verdicts.push({
      seq: entry.seq,
      claimed: entry.hash,
      computed,
      bodyOk: computed === entry.hash,
      linkOk: entry.prevHash === expectedPrev,
    });
  }

  return verdicts;
}

export function shortHash(hash: string): string {
  return `0x${hash.slice(0, 6)}..${hash.slice(-4)}`;
}
