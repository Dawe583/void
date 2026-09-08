import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { applyRedaction } from "./redact.ts";
import { makeGetError, makePutError, sha256Digest, type PutError, type RedactionHook, type RetentionPlan, type RetentionReport, type SnapshotNamespace, type SnapshotReference, type SnapshotStore } from "./store.ts";

export type LocalSnapshotStoreOptions = {
  readonly maxBytes?: number;
  readonly redaction?: RedactionHook;
  readonly clock?: () => Date;
};

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export function LocalSnapshotStore(root: string, options: LocalSnapshotStoreOptions = {}): SnapshotStore {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const redaction = options.redaction;
  const clock = options.clock ?? (() => new Date());

  return {
    async put(namespace, bytes, metadata = {}) {
      try {
        assertSafeNamespace(namespace);
      } catch (error) {
        throw makePutError("InvalidNamespace", namespace, "invalid snapshot namespace", error);
      }
      let redacted: Uint8Array;
      try {
        redacted = await applyRedaction(bytes, redaction, namespace, metadata);
      } catch (error) {
        throw makePutError("RedactionFailed", namespace, "snapshot redaction failed", error);
      }

      const digest = sha256Digest(redacted);
      const digestHex = digest.slice("sha256:".length);
      const dir = namespaceDir(root, namespace);
      const path = join(dir, digestHex);
      const tmp = join(dir, `.tmp-${process.pid}-${clock().getTime()}-${Math.random().toString(16).slice(2)}`);

      try {
        await mkdir(dir, { recursive: true });
        await writeAll(tmp, redacted);
        await rename(tmp, path).catch(async (error: unknown) => {
          await rm(tmp, { force: true });
          const existing = await readFile(path).catch(() => undefined);
          if (existing !== undefined && sha256Digest(existing) === digest) {
            return;
          }
          throw error;
        });
        await enforceBudget(root, namespace, maxBytes);
      } catch (error) {
        if (isPutError(error)) {
          throw error;
        }
        throw makePutError("WriteFailed", namespace, "snapshot write failed", error);
      }

      return { digest, reference: { namespace, digest, uri: `file://${path}` } };
    },

    async get(reference) {
      try {
        assertSafeReference(reference);
      } catch (error) {
        throw makeGetError("InvalidReference", reference, "invalid snapshot reference", error);
      }
      const path = pathForReference(root, reference);
      let bytes: Uint8Array;
      try {
        bytes = await readFile(path);
      } catch (error) {
        throw makeGetError("SnapshotUnavailable", reference, "snapshot is unavailable", error);
      }
      const digest = sha256Digest(bytes);
      if (digest !== reference.digest) {
        throw makeGetError("DigestMismatch", reference, "snapshot digest mismatch");
      }
      return bytes;
    },

    async retention(namespace) {
      assertSafeNamespace(namespace);
      const files = await snapshotFiles(root, namespace);
      const retainedBytes = files.reduce((total, file) => total + file.size, 0);
      return {
        namespace,
        retainedBytes,
        deleteOlderThan: (cutoff) => deleteOlderThan(root, namespace, cutoff),
      } satisfies RetentionPlan;
    },
  } satisfies SnapshotStore;
}

async function writeAll(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function enforceBudget(root: string, namespace: SnapshotNamespace, maxBytes: number): Promise<RetentionReport> {
  const files = await snapshotFiles(root, namespace);
  let retained = files.reduce((total, file) => total + file.size, 0);
  let deleted = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (retained <= maxBytes) {
      break;
    }
    try {
      await rm(file.path, { force: true });
      retained -= file.size;
      deleted += 1;
      freedBytes += file.size;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) {
    throw makePutError("RetentionFailed", namespace, "snapshot retention failed", errors);
  }
  return { deleted, freedBytes, errors };
}

async function deleteOlderThan(root: string, namespace: SnapshotNamespace, cutoff: Date): Promise<RetentionReport> {
  const files = await snapshotFiles(root, namespace);
  let deleted = 0;
  let freedBytes = 0;
  const errors: string[] = [];
  for (const file of files) {
    if (file.mtimeMs >= cutoff.getTime()) {
      continue;
    }
    try {
      await rm(file.path, { force: true });
      deleted += 1;
      freedBytes += file.size;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { deleted, freedBytes, errors };
}

type SnapshotFile = { readonly path: string; readonly size: number; readonly mtimeMs: number };

async function snapshotFiles(root: string, namespace: SnapshotNamespace): Promise<SnapshotFile[]> {
  const dir = namespaceDir(root, namespace);
  const names = await readdir(dir).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files: SnapshotFile[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}$/.test(name)) {
      continue;
    }
    const path = join(dir, name);
    const stats = await stat(path);
    if (stats.isFile()) {
      files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
    }
  }
  return files;
}

function namespaceDir(root: string, namespace: SnapshotNamespace): string {
  return join(root, encodeURIComponent(namespace));
}

function pathForReference(root: string, reference: SnapshotReference): string {
  return join(namespaceDir(root, reference.namespace), reference.digest.slice("sha256:".length));
}

function assertSafeNamespace(namespace: SnapshotNamespace): void {
  if (namespace.length === 0 || namespace.includes("/") || namespace.includes("\\") || namespace === "." || namespace === "..") {
    throw new Error("invalid snapshot namespace");
  }
}

function assertSafeReference(reference: SnapshotReference): void {
  assertSafeNamespace(reference.namespace);
  if (!/^sha256:[a-f0-9]{64}$/.test(reference.digest)) {
    throw new Error("invalid snapshot digest");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isPutError(error: unknown): error is PutError {
  return error instanceof Error && "kind" in error && "namespace" in error;
}
