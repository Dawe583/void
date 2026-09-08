export type ProbeCall = {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
};

export type ProbeResult =
  | { readonly radius?: number; readonly facts?: Readonly<Record<string, string>>; readonly note?: string }
  | { readonly error: string };

export type ProbeExecutor = {
  readonly query?: (statement: string, params?: readonly unknown[]) => Promise<readonly Readonly<Record<string, unknown>>[]>;
  readonly s3?: {
    readonly listObjectsV2: (input: { readonly bucket: string; readonly prefix: string | undefined; readonly continuationToken?: string }) => Promise<{ readonly keyCount: number; readonly nextContinuationToken?: string }>;
    readonly getBucketVersioning: (input: { readonly bucket: string }) => Promise<{ readonly status?: string; readonly mfaDelete?: string }>;
  };
};

export interface Probe {
  readonly id: string;
  readonly run: (call: ProbeCall, exec: ProbeExecutor) => Promise<ProbeResult>;
}

const BLAST_KEYS = ["rows", "count", "limit", "n"] as const;

export function pickProbes(connectorId: string): readonly Probe[] {
  if (connectorId === "postgres") return postgresProbes;
  if (connectorId === "s3" || connectorId === "aws.s3") return s3Probes;
  return [];
}

export function fallbackBlastRadius(args: Readonly<Record<string, unknown>>): number | undefined {
  for (const key of BLAST_KEYS) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

import { countProbe, cascadeProbe } from "./postgres.ts";
import { objectCountProbe, versioningProbe } from "./s3.ts";

const postgresProbes: readonly Probe[] = [countProbe, cascadeProbe];
const s3Probes: readonly Probe[] = [objectCountProbe, versioningProbe];
