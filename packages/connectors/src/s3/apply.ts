import type { S3Client, S3DeleteCall } from "./classify.ts";
import { sha256, type SnapshotReference, type SnapshotStore } from "./capture.ts";
import { restoreObject } from "./inverse.ts";

export type DriftChange = {
  readonly target: string;
  readonly key: Readonly<Record<string, string>>;
  readonly field: string;
  readonly capturedDigest: `sha256:${string}`;
  readonly currentDigest: `sha256:${string}`;
};

export type ReplayRefusal = {
  readonly stepId: string;
  readonly reason: "drift" | "missing_target" | "permission_denied" | "internal_error";
  readonly changed: readonly DriftChange[];
};

export type ApplyReport = {
  readonly applied: readonly string[];
  readonly refused: readonly ReplayRefusal[];
};

export type ApplyRestoreInput = {
  readonly stepId: string;
  readonly call: S3DeleteCall;
  readonly reference: SnapshotReference;
  readonly capturedEtag?: string;
};

export async function applyRestore(store: SnapshotStore, client: S3Client, input: ApplyRestoreInput): Promise<ApplyReport> {
  const current = await client.getObject(input.call).catch((error: unknown) => {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  });

  if (input.capturedEtag !== undefined && current?.etag !== undefined && current.etag !== input.capturedEtag) {
    return {
      applied: [],
      refused: [{
        stepId: input.stepId,
        reason: "drift",
        changed: [{
          target: "s3.object",
          key: { bucket: input.call.bucket, key: input.call.key },
          field: "etag",
          capturedDigest: input.reference.digest,
          currentDigest: current.body === undefined ? sha256(new Uint8Array()) : sha256(current.body),
        }],
      }],
    };
  }

  const bytes = await store.get(input.reference);
  try {
    await restoreObject(client, input.call, { bytes, etag: input.capturedEtag, ...(current?.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }) });
  } catch (error) {
    const conflict = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return { applied: [], refused: [{ stepId: input.stepId, reason: conflict === 412 || conflict === 409 ? "drift" : "internal_error", changed: [] }] };
  }
  return { applied: [input.stepId], refused: [] };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Readonly<Record<string, unknown>>;
  return record.name === "NoSuchKey" || record.code === "NoSuchKey" || record.statusCode === 404;
}
