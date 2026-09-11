import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readdir, lstat, chmod, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../ledger/src/canonical.ts";
import { digest } from "./journal.ts";
import {
  localRecoveryVault,
  VaultCapacityError,
  type RecoveryVault,
  type VaultReference,
  type VaultSlot,
} from "./vault.ts";
import type { Json } from "../../connectors/src/recovery.ts";
const slots: readonly VaultSlot[] = ["capture", "outcome", "recovery"];
const identity = (value: string) => {
  if (typeof value !== "string" || !/^[\w-]{1,120}$/.test(value))
    throw new Error("Invalid vault identity.");
};
export type VaultCapacity = { maxArtifactBytes: number; maxTotalBytes: number };
/** Encrypted payloads and quota changes commit in one SQLite transaction.
 * ponytail: whole JSON artifacts, local disk, one writer. Streaming and retention
 * need another format; no eviction of recovery evidence is implicit here. */
export function reservedRecoveryVault(
  root: string,
  keys: Readonly<Record<string, Uint8Array>>,
  currentKey: string,
  capacity: VaultCapacity = {
    maxArtifactBytes: 64 * 1024 * 1024,
    maxTotalBytes: 1024 * 1024 * 1024,
  },
): RecoveryVault {
  const { maxArtifactBytes, maxTotalBytes } = capacity;
  for (const value of [maxArtifactBytes, maxTotalBytes])
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > Number.MAX_SAFE_INTEGER / 4
    )
      throw new Error("Invalid vault capacity.");
  const key = keys[currentKey];
  identity(currentKey);
  if (!key || key.byteLength !== 32)
    throw new Error("A 256-bit recovery key is required.");
  const rootPath = resolve(root),
    legacy = localRecoveryVault(rootPath, keys, currentKey, maxArtifactBytes),
    slotBytes = maxArtifactBytes + 28;
  async function legacyBytes(): Promise<number> {
    let bytes = 0;
    for (const entry of await readdir(rootPath, { withFileTypes: true })) {
      if (
        entry.name === "vault.sqlite" ||
        entry.name.startsWith("vault.sqlite-")
      )
        continue;
      if (!entry.isDirectory())
        throw new Error("Unexpected entry in legacy vault.");
      for (const file of await readdir(join(rootPath, entry.name), {
        withFileTypes: true,
      })) {
        if (!file.isFile()) throw new Error("Unexpected legacy artifact.");
        bytes += (await lstat(join(rootPath, entry.name, file.name))).size;
      }
    }
    return bytes;
  }
  async function transaction<T>(
    run: (db: DatabaseSync, used: number) => T,
  ): Promise<T> {
    await mkdir(rootPath, { recursive: true, mode: 0o700 });
    const oldBytes = await legacyBytes(),
      path = join(rootPath, "vault.sqlite"),
      db = new DatabaseSync(path);
    try {
      await chmod(path, 0o600);
      db.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=FULL");
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          db.exec("BEGIN IMMEDIATE");
          break;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("database is locked") ||
            Date.now() >= deadline
          )
            throw error;
          await delay(25);
        }
      }
      db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),capacity TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts(workspace TEXT NOT NULL,digest TEXT NOT NULL,key_id TEXT NOT NULL,data BLOB NOT NULL,operation_id TEXT,slot TEXT,content_digest TEXT NOT NULL,PRIMARY KEY(workspace,digest),UNIQUE(workspace,operation_id,slot));
    CREATE TABLE IF NOT EXISTS reservations(workspace TEXT NOT NULL,operation_id TEXT NOT NULL,slot TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(workspace,operation_id,slot));`);
      const limits = canonicalJson({ maxArtifactBytes, maxTotalBytes });
      db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(limits);
      if (
        db.prepare("SELECT capacity FROM settings WHERE id=1").get()!
          .capacity !== limits
      )
        throw new Error(
          "Vault capacity differs from its persisted configuration.",
        );
      const used =
        Number(
          db
            .prepare(
              "SELECT COALESCE((SELECT SUM(length(data)) FROM artifacts),0)+COALESCE((SELECT SUM(bytes) FROM reservations),0) AS bytes",
            )
            .get()!.bytes,
        ) + oldBytes;
      const result = run(db, used);
      db.exec("COMMIT");
      const directory = await open(rootPath, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return result;
    } finally {
      db.close();
    }
  }
  const decode = (
    workspace: string,
    reference: VaultReference,
    bytes: Buffer,
  ): Json => {
    if (
      bytes.length !== reference.bytes ||
      digest(bytes.toString("base64")) !== reference.digest
    )
      throw new Error("Recovery artifact digest or size mismatch.");
    if (!Object.hasOwn(keys, reference.keyId))
      throw new Error("Recovery key unavailable.");
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
  };
  return {
    async reserve(workspace, operationId, requested = slots) {
      identity(workspace);
      identity(operationId);
      if (
        !requested.length ||
        new Set(requested).size !== requested.length ||
        requested.some((slot) => !slots.includes(slot))
      )
        throw new Error("Invalid vault slots.");
      await transaction((db, used) => {
        let extra = 0;
        for (const slot of requested) {
          if (
            db
              .prepare(
                "SELECT 1 FROM artifacts WHERE workspace=? AND operation_id=? AND slot=?",
              )
              .get(workspace, operationId, slot)
          )
            continue;
          const prior = db
            .prepare(
              "SELECT bytes FROM reservations WHERE workspace=? AND operation_id=? AND slot=?",
            )
            .get(workspace, operationId, slot);
          extra += Math.max(0, slotBytes - Number(prior?.bytes ?? 0));
          db.prepare(
            "INSERT INTO reservations VALUES(?,?,?,?) ON CONFLICT(workspace,operation_id,slot) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)",
          ).run(workspace, operationId, slot, slotBytes);
        }
        if (used + extra > maxTotalBytes)
          throw new VaultCapacityError("Recovery vault total quota exhausted.");
      });
    },
    async release(workspace, operationId) {
      identity(workspace);
      identity(operationId);
      await transaction((db) => {
        db.prepare(
          "DELETE FROM reservations WHERE workspace=? AND operation_id=?",
        ).run(workspace, operationId);
      });
    },
    async put(workspace, value, allocation) {
      identity(workspace);
      if (allocation) {
        identity(allocation.operationId);
        if (!slots.includes(allocation.slot))
          throw new Error("Invalid vault slot.");
      }
      const plain = Buffer.from(canonicalJson(value)),
        contentDigest = digest(value);
      if (plain.length > maxArtifactBytes)
        throw new VaultCapacityError("Recovery artifact exceeds quota.");
      return transaction((db, used) => {
        const prior = allocation
          ? db
              .prepare(
                "SELECT digest,key_id,data,content_digest FROM artifacts WHERE workspace=? AND operation_id=? AND slot=?",
              )
              .get(workspace, allocation.operationId, allocation.slot)
          : undefined;
        if (prior) {
          if (prior.content_digest !== contentDigest)
            throw new Error("Vault slot belongs to different evidence.");
          const bytes = Buffer.from(prior.data as Uint8Array),
            reference = {
              digest: String(prior.digest),
              keyId: String(prior.key_id),
              bytes: bytes.length,
            };
          decode(workspace, reference, bytes);
          return reference;
        }
        const reserved = allocation
          ? db
              .prepare(
                "SELECT bytes FROM reservations WHERE workspace=? AND operation_id=? AND slot=?",
              )
              .get(workspace, allocation.operationId, allocation.slot)
          : undefined;
        if (allocation && !reserved)
          throw new Error("Recovery slot is not reserved.");
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(
          Buffer.from(`void.recovery.v1:${workspace}:${currentKey}`),
        );
        const data = Buffer.concat([
          iv,
          Buffer.alloc(16),
          cipher.update(plain),
          cipher.final(),
        ]);
        cipher.getAuthTag().copy(data, 12);
        const reference = {
          digest: digest(data.toString("base64")),
          keyId: currentKey,
          bytes: data.length,
        };
        if (
          data.length > Number(reserved?.bytes ?? maxTotalBytes) ||
          used - Number(reserved?.bytes ?? 0) + data.length > maxTotalBytes
        )
          throw new VaultCapacityError("Recovery vault total quota exhausted.");
        db.prepare("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)").run(
          workspace,
          reference.digest,
          currentKey,
          data,
          allocation?.operationId ?? null,
          allocation?.slot ?? null,
          contentDigest,
        );
        if (allocation)
          db.prepare(
            "DELETE FROM reservations WHERE workspace=? AND operation_id=? AND slot=?",
          ).run(workspace, allocation.operationId, allocation.slot);
        return reference;
      });
    },
    async get(workspace, reference) {
      identity(workspace);
      if (!/^[a-f0-9]{64}$/.test(reference.digest))
        throw new Error("Invalid recovery reference.");
      const row = await transaction((db) =>
        db
          .prepare("SELECT data FROM artifacts WHERE workspace=? AND digest=?")
          .get(workspace, reference.digest),
      );
      return row
        ? decode(workspace, reference, Buffer.from(row.data as Uint8Array))
        : legacy.get(workspace, reference);
    },
  };
}
