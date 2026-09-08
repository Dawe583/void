import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

export function manifestWriter(snapshotDir: string): ManifestWriter {
  return {
    write: async (entry) => {
      await mkdir(snapshotDir, { recursive: true });
      const records = await manifestReader(snapshotDir);
      await writeManifest(snapshotDir, [...records, validateEntry(entry, records.length + 1)]);
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
  await rename(temporary, target);
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
