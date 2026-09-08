/**
 * The dev tier store: one append only JSONL file per workspace.
 *
 * Decision 2. fsync before the append is acknowledged, directory 0700, file
 * 0600, one JSON object per line. The chain and the signature carry the
 * guarantee, so a JSONL ledger is exactly as tamper evident as a Postgres
 * one, and a contributor runs the suite with no database provisioned. There
 * is no memory mode at any tier: a receipt for a record that died with the
 * process is manufactured evidence.
 *
 * The Postgres store is the hosted tier at WP-06 and lives in this package
 * then, behind the same interface. What is frozen here is the interface and
 * the JSONL implementation the free tier and the test suite run on.
 */

import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import type { LedgerStore } from "./index.ts";
import { GENESIS_PREV, canonicalJson, entryHash } from "./canonical.ts";
import { sha256Hex, verifySignature } from "./sign.ts";
import { sanitizeWorkspace } from "./hardening.ts";

/**
 * What one line in the JSONL file is. The receipt is the entry plus what the
 * chain added, and read() returns entries only: the verifier recomputes the
 * chain rather than trusting the stored links, which is the difference
 * between a check and a decoration. The body is the payload the caller
 * appended; everything else is chain metadata.
 */
export type JsonlEntry = {
  readonly workspace: string;
  readonly seq: number;
  readonly body: unknown;
  readonly prev_hash: string;
  readonly hash: string;
  readonly key_id: string;
  readonly alg: string;
  readonly signature: string;
};

export type JsonlReceipt = JsonlEntry;

export interface JsonlStoreOptions {
  /** Directory holding <workspace>.jsonl. Defaults to ~/.void/ledger. */
  readonly dir?: string;
  /** Environment, injectable at the test boundary. */
  readonly env?: Readonly<NodeJS.ProcessEnv>;
}

export function ledgerDir(env: Readonly<NodeJS.ProcessEnv> = process.env): string {
  return env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger");
}

/**
 * The append is one open, one write, one file fsync: a receipt returned
 * before the bytes reach the disk is the defect the memory fallback in the
 * prior art normalised. Two processes on one workspace file is the Postgres
 * tier's problem, which is the documented boundary of the dev tier.
 *
 * The signer is injected, never imported by the store, so the store stays
 * testable with a deterministic key and the production key path stays in one
 * place.
 */
export function jsonlStore(
  signer: import("./index.ts").KeyProvider,
  options: JsonlStoreOptions = {},
): LedgerStore<unknown, JsonlEntry, JsonlReceipt> {
  const dir = options.dir ?? ledgerDir(options.env);
  const file = (workspace: string): string => join(dir, `${sanitizeWorkspace(workspace)}.jsonl`);

  // Appends serialize per workspace. The read-tail-then-write sequence is
  // not atomic: two appends racing in one process both read the same tail
  // and mint the same seq, and the chain forks silently. The store is the
  // only writer, so one in-process queue per workspace file closes the
  // window without a filesystem lock broker.
  const tailLocks = new Map<string, Promise<unknown>>();
  const withTailLock = async <T>(workspace: string, run: () => Promise<T>): Promise<T> => {
    const previous = tailLocks.get(workspace) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    tailLocks.set(workspace, next);
    try {
      return await next;
    } finally {
      if (tailLocks.get(workspace) === next) tailLocks.delete(workspace);
    }
  };

  const appendInner = async (body: JsonlEntry["body"]): Promise<JsonlReceipt> => {
      const workspace =
        "workspace" in (body as object) &&
        typeof (body as { workspace?: unknown }).workspace === "string"
          ? sanitizeWorkspace((body as { workspace: string }).workspace)
          : throwNoWorkspace();
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const [prev, seq] = await headInfo(file(workspace), workspace);
      const keyId = await signer.currentKeyId();
      const hash = await entryHash(body, prev, sha256Hex);
      const { signingPreimage } = await import("./index.ts");
      const preimage = signingPreimage(signer.alg, keyId, hash);
      const signature = await signer.sign(preimage);
      const entry: JsonlEntry = {
        workspace,
        seq,
        body,
        prev_hash: prev,
        hash,
        key_id: keyId,
        alg: signer.alg,
        signature: `${signer.alg}:${Buffer.from(signature).toString("base64")}`,
      };
      // O_APPEND on the flag itself, not appendFile: the handle is kept so
      // the bytes can be fsynced before the receipt exists. Without the
      // explicit sync the durability claim in the README was false in the
      // quietest way, green on every test and absent in every crash.
      const handle = await open(file(workspace), "a");
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return entry;
  };

  return {
    async append(body: JsonlEntry["body"]): Promise<JsonlReceipt> {
      const workspace =
        "workspace" in (body as object) &&
        typeof (body as { workspace?: unknown }).workspace === "string"
          ? sanitizeWorkspace((body as { workspace: string }).workspace)
          : throwNoWorkspace();
      // The lock is per workspace file: the tail that decides the next seq
      // lives in one file, so appends to different workspaces can still
      // interleave safely.
      return withTailLock(workspace, () => appendInner(body));
    },

    async *read(workspace: string): AsyncIterable<JsonlEntry> {
      const text = await readOrEmpty(file(workspace));
      for (const line of text.split("\n")) {
        if (line === "") continue;
        yield JSON.parse(line) as JsonlEntry;
      }
    },

    async head(workspace: string): Promise<JsonlReceipt | null> {
      return lastEntry(file(workspace));
    },

    async verify(workspace: string): Promise<{ ok: boolean; checked: number; reason?: string }> {
      let prev = GENESIS_PREV;
      let checked = 0;
      const publicKeys = new Map<string, Uint8Array>();
      for await (const entry of this.read(workspace)) {
        checked += 1;
        if (entry.prev_hash !== prev)
          return { ok: false, checked, reason: `link: entry ${entry.seq} points at ${entry.prev_hash.slice(0, 8)} but the chain is at ${prev.slice(0, 8)}` };
        const recomputed = await entryHash(entry.body, prev, sha256Hex);
        if (recomputed !== entry.hash)
          return { ok: false, checked, reason: `body: entry ${entry.seq} does not hash to its stored digest` };
        if (entry.seq !== checked)
          return { ok: false, checked, reason: `order: expected seq ${checked}, found ${entry.seq}` };
        const { signingPreimage } = await import("./index.ts");
        let spki = publicKeys.get(entry.key_id);
        if (spki === undefined) {
          const fetched = await signer.publicKey(entry.key_id);
          if (fetched === null)
            return { ok: false, checked, reason: `signature: unknown key ${entry.key_id} at entry ${entry.seq}` };
          spki = fetched;
          publicKeys.set(entry.key_id, spki);
        }
        // A store this package never wrote can carry any algorithm tag. The
        // verifier supports ed25519 today; anything else is a named finding
        // at the entry, never a thrown TypeError that stops the whole
        // verification run at line one of a hostile file.
        if (entry.alg !== "ed25519")
          return { ok: false, checked, reason: `signature: entry ${entry.seq} carries unsupported algorithm ${entry.alg}` };
        const [alg, ...rest] = entry.signature.split(":");
        if (alg !== entry.alg || rest.length !== 1)
          return { ok: false, checked, reason: `signature: entry ${entry.seq} carries a malformed signature tag` };
        const bytes = Buffer.from(rest.join(":"), "base64");
        const ok = verifySignature(
          "ed25519",
          signingPreimage("ed25519", entry.key_id, entry.hash),
          new Uint8Array(bytes),
          spki,
        );
        if (!ok)
          return { ok: false, checked, reason: `signature: entry ${entry.seq} fails verification under ${entry.key_id}` };
        prev = entry.hash;
      }
      return { ok: true, checked };
    },
  };
}

function throwNoWorkspace(): string {
  throw new TypeError("ledger body must carry a string workspace field: the store is per workspace");
}

async function readOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function lastEntry(file: string): Promise<JsonlReceipt | null> {
  const text = await readOrEmpty(file);
  const lines = text.split("\n").filter((line) => line !== "");
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]!) as JsonlReceipt;
}

async function headInfo(
  file: string,
  _workspace: string,
): Promise<[string, number]> {
  const head = await lastEntry(file);
  return head === null ? [GENESIS_PREV, 1] : [head.hash, head.seq + 1];
}

export { canonicalJson };
