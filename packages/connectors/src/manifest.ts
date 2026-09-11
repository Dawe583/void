import { mkdir, readFile, rename, writeFile, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { SnapshotReference } from "./snapshot/store.ts";

export type SnapshotManifestEntry = {
  readonly digest: string;
  readonly reference: SnapshotReference;
  readonly tool: string;
};

export type ManifestWriter = {
  readonly write: (entry: SnapshotManifestEntry) => Promise<void>;
};

const MANIFEST_FILE = "manifest.jsonl";

const writers = new Map<string, Promise<void>>();

export function manifestWriter(snapshotDir: string): ManifestWriter {
  return {
    write: (entry) => {
      const key = resolve(snapshotDir);
      const next = (writers.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
        await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
        // Another process must fail closed, rather than overwrite a newer manifest.
        // A stale lock requires operator inspection; never guess its owner is dead.
        const lock = join(snapshotDir, `${MANIFEST_FILE}.lock`);
        const handle = await open(lock, 'wx', 0o600);
        try { const records = await manifestReader(snapshotDir); await writeManifest(snapshotDir, [...records, validateEntry(entry, records.length + 1)]); }
        finally { await handle.close(); await unlink(lock); }
      });
      writers.set(key, next);
      void next.finally(() => { if (writers.get(key) === next) writers.delete(key); }).catch(() => {});
      return next;
    },
  };
}

export async function manifestReader(snapshotDir: string): Promise<readonly SnapshotManifestEntry[]> {
  let text: string;
  try {
    text = await readFile(join(snapshotDir, MANIFEST_FILE), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const records: SnapshotManifestEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`manifest line ${index + 1} is not JSON`);
    }
    records.push(validateEntry(parsed, index + 1));
  }
  return records;
}

export async function findEntry(snapshotDir: string, digest: string, tool: string): Promise<SnapshotManifestEntry | null> {
  const records = await manifestReader(snapshotDir);
  return records.find((entry) => entry.digest === digest && entry.tool === tool) ?? null;
}

async function writeManifest(snapshotDir: string, records: readonly SnapshotManifestEntry[]): Promise<void> {
  const target = join(snapshotDir, MANIFEST_FILE);
  const temporary = join(snapshotDir, `${MANIFEST_FILE}.${process.pid}.${randomUUID()}.tmp`);
  const text = records.map((record) => JSON.stringify(record)).join("\n") + (records.length === 0 ? "" : "\n");
  await writeFile(temporary, text, { mode: 0o600 });
  const handle = await open(temporary, "r");
  try { await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
  const directory = await open(snapshotDir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

function validateEntry(value: unknown, line: number): SnapshotManifestEntry {
  if (typeof value !== "object" || value === null) throw new Error(`manifest line ${line} is not an object`);
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.digest !== "string" || record.digest === "") throw new Error(`manifest line ${line} has no digest`);
  if (typeof record.tool !== "string" || record.tool === "") throw new Error(`manifest line ${line} has no tool`);
  if (!isSnapshotReference(record.reference)) throw new Error(`manifest line ${line} has invalid reference`);
  return { digest: record.digest, reference: record.reference, tool: record.tool };
}

function isSnapshotReference(value: unknown): value is SnapshotReference {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.namespace === "string"
    && record.namespace !== ""
    && typeof record.digest === "string"
    && record.digest.startsWith("sha256:")
    && typeof record.uri === "string"
    && record.uri !== "";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as Readonly<Record<string, unknown>>).code === "ENOENT";
}
