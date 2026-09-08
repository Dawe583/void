/**
 * ed25519 signing through node:crypto, and nothing else.
 *
 * Decision 3. The entire cryptographic dependency budget is the platform: a
 * userland curve library is the single worst place to spend supply chain
 * risk in a component whose job is to be trustworthy. The interface is async
 * from the first line because every KMS is a network call, and there is no
 * way to export private key material because exported key material reaches
 * a log or a crash dump eventually.
 *
 * Development keys are generated on first append into ~/.void/keys at mode
 * 0600 and carry a dev- prefix in the key id, so the verifier can report
 * "valid, development key" and never plain valid. In production the same
 * interface is backed by KMS and no calling code changes.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { Alg, KeyProvider } from "./index.ts";
import { canonicalJson, entryHash } from "./canonical.ts";
import { assertPrivateKeyFileMode } from "./hardening.ts";

/** The digest engine. Swappable at the test boundary, node:crypto in production. */
export const sha256Hex = async (input: string): Promise<string> =>
  createHash("sha256").update(input).digest("hex");

export function keyIdFromSpki(spki: Uint8Array): string {
  const digest = createHash("sha256").update(spki).digest("hex");
  return `ed25519:${digest.slice(0, 16)}`;
}

export interface DevKeyProviderOptions {
  /** Directory for the development key material. Defaults to ~/.void/keys. */
  readonly dir?: string;
  /** Environment, injectable at the test boundary. */
  readonly env?: Readonly<NodeJS.ProcessEnv>;
}

/**
 * The dev tier key path. VOID_SIGNING_KEY wins if set (base64 PKCS8); the
 * key file is generated and written once, 0600, and reused after. The one
 * loud line about a development key being in use is printed by the caller
 * (the CLI), not here, because a library that prints at import time is a
 * library nobody can script.
 */
export async function devKeyProvider(
  options: DevKeyProviderOptions = {},
): Promise<KeyProvider> {
  const dir = options.dir ?? join(homedir(), ".void", "keys");
  const env = options.env ?? process.env;
  const inline = env.VOID_SIGNING_KEY;
  if (inline !== undefined && inline !== "") {
    return keyProviderFromPkcs8(Buffer.from(inline, "base64"));
  }
  return keyProviderFromDirectory(dir);
}

export function keyProviderFromPkcs8(pkcs8: Buffer): KeyProvider {
  // DER, named explicitly: a bare Buffer defaults to PEM parsing and fails
  // with an opaque OpenSSL decoder error on the exact bytes export produced.
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new TypeError(
      `expected an ed25519 private key, got ${String(privateKey.asymmetricKeyType)}`,
    );
  const spki = publicKeyBytes(privateKey);
  const keyId = `dev-${keyIdFromSpki(spki)}`;
  return {
    alg: "ed25519",
    async currentKeyId() {
      return keyId;
    },
    async sign(input: Uint8Array) {
      return cryptoSign(null, input, privateKey);
    },
    async publicKey(id: string) {
      return id === keyId ? spki : null;
    },
  };
}

async function keyProviderFromDirectory(dir: string): Promise<KeyProvider> {
  const file = join(dir, "dev-ed25519.pkcs8");
  try {
    return keyProviderFromPkcs8(await readExistingKey(file));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    return keyProviderFromPkcs8(await generateAndWriteKey(dir, file));
  } catch (error) {
    if (!isAlreadyThere(error)) throw error;
    // Two processes on one fresh directory: O_EXCL lost the race, so the
    // winner's key is on disk and the loser must adopt it rather than keep a
    // key nobody else will ever verify with. The winner is still mid write
    // in the worst interleaving and the file exists but is not yet whole, so
    // any unreadable read back is retried, never accepted as a key.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return keyProviderFromPkcs8(await readExistingKey(file));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    throw new Error(`development key at ${file} never became readable`);
  }
}

async function readExistingKey(file: string): Promise<Buffer> {
  await assertPrivateKeyFileMode(file);
  return readFile(file);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAlreadyThere(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

async function generateAndWriteKey(dir: string, file: string): Promise<Buffer> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // O_EXCL, never O_TRUNC: a symlink pre placed at the file path would
  // otherwise carry the private key to any path an attacker chose, and the
  // write would succeed quietly. O_CREAT|O_EXCL refuses to follow it.
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(pkcs8);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return pkcs8;
}

function publicKeyBytes(privateKey: ReturnType<typeof createPrivateKey>): Uint8Array {
  const spki = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  return new Uint8Array(spki);
}

/** Verify a signature against an SPKI public key. Algorithm agnostic. */
export function verifySignature(
  alg: Alg,
  input: Uint8Array,
  signature: Uint8Array,
  spki: Uint8Array,
): boolean {
  if (alg !== "ed25519")
    throw new TypeError(`unsupported verification algorithm ${alg}`);
  try {
    return cryptoVerify(
      null,
      input,
      createPublicKey({
        key: Buffer.from(spki),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

export { canonicalJson, entryHash };
