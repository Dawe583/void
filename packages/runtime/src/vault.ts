import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson } from "../../ledger/src/canonical.ts";
import { digest } from "./journal.ts";
import type { Json } from "../../connectors/src/recovery.ts";
export type VaultReference = { digest: string; keyId: string; bytes: number };
export class VaultCapacityError extends Error {}
export type VaultSlot = "capture" | "outcome" | "recovery";
export type VaultAllocation = { operationId: string; slot: VaultSlot };
export interface RecoveryVault {
  put(
    workspace: string,
    value: Json,
    allocation?: VaultAllocation,
  ): Promise<VaultReference>;
  get(workspace: string, reference: VaultReference): Promise<Json>;
  reserve?(
    workspace: string,
    operationId: string,
    slots?: readonly VaultSlot[],
  ): Promise<void>;
  release?(workspace: string, operationId: string): Promise<void>;
}
/** Recovery artifacts remain pinned: this store never evicts an active inverse.
 * Quota exhaustion refuses a new artifact; lifecycle-aware GC is a separate operation. */
export function localRecoveryVault(
  root: string,
  keys: Readonly<Record<string, Uint8Array>>,
  currentKey: string,
  maxArtifactBytes = 64 * 1024 * 1024,
): RecoveryVault {
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1)
    throw new Error("Invalid recovery artifact quota.");
  const key = keys[currentKey];
  if (!key || key.byteLength !== 32 || !/^[\w-]{1,100}$/.test(currentKey))
    throw new Error("A 256-bit recovery key and safe key ID are required.");
  const directory = (workspace: string) => {
    if (!/^[\w-]{1,100}$/.test(workspace))
      throw new Error("Invalid vault workspace.");
    return join(resolve(root), workspace);
  };
  return {
    async put(workspace, value) {
      const plain = Buffer.from(canonicalJson(value));
      if (plain.length > maxArtifactBytes)
        throw new VaultCapacityError("Recovery artifact exceeds quota.");
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`void.recovery.v1:${workspace}:${currentKey}`));
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const bytes = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
      const reference = {
        digest: digest(bytes.toString("base64")),
        keyId: currentKey,
        bytes: bytes.length,
      };
      const dir = directory(workspace);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = join(dir, `.tmp-${randomBytes(16).toString("hex")}`);
      const handle = await open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, join(dir, reference.digest));
      const parent = await open(dir, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      return reference;
    },
    async get(workspace, reference) {
      if (
        !/^[a-f0-9]{64}$/.test(reference.digest) ||
        !Object.hasOwn(keys, reference.keyId)
      )
        throw new Error("Invalid or unavailable recovery reference.");
      const path = join(directory(workspace), reference.digest);
      const metadata = await stat(path);
      if (
        metadata.size !== reference.bytes ||
        metadata.size > maxArtifactBytes + 28
      )
        throw new Error("Recovery artifact size mismatch.");
      const bytes = await readFile(path);
      if (digest(bytes.toString("base64")) !== reference.digest)
        throw new Error("Recovery artifact digest mismatch.");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        keys[reference.keyId]!,
        bytes.subarray(0, 12),
      );
      cipher.setAAD(
        Buffer.from(`void.recovery.v1:${workspace}:${reference.keyId}`),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          cipher.update(bytes.subarray(28)),
          cipher.final(),
        ]).toString(),
      );
    },
  };
}
