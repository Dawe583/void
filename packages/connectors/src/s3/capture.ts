import { createHash } from "node:crypto";

import type { ConnectorFact, S3Client, S3DeleteCall } from "./classify.ts";

export type SnapshotReference = { readonly namespace: string; readonly digest: `sha256:${string}`; readonly uri: string };
export type SnapshotPutResult = { readonly digest: `sha256:${string}`; readonly reference: SnapshotReference };
export type SnapshotStore = {
  readonly put: (namespace: string, bytes: Uint8Array, metadata?: Readonly<Record<string, string>>) => Promise<SnapshotPutResult>;
  readonly get: (reference: SnapshotReference) => Promise<Uint8Array>;
};

export type CaptureObjectResult = {
  readonly digest: `sha256:${string}`;
  readonly reference: SnapshotReference;
  readonly facts: readonly ConnectorFact[];
  readonly capturedAt: string;
  readonly etag: string | undefined;
};

export class CaptureFailedError extends Error {
  readonly kind = "CaptureFailed";
  readonly connector = "s3";
  readonly call = "aws.s3.object.delete";
  readonly retryable = true;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "CaptureFailedError";
    this.details = details;
  }
}

export async function captureObject(store: SnapshotStore, client: S3Client, call: S3DeleteCall, now: () => Date = () => new Date()): Promise<CaptureObjectResult> {
  const capturedAt = now().toISOString();
  const object = await client.getObject(call).catch((error: unknown) => {
    throw new CaptureFailedError("failed to read S3 object before delete", { bucket: call.bucket, key: call.key, error: String(error) });
  });

  if (object.body === undefined) {
    throw new CaptureFailedError("S3 object read returned no body", { bucket: call.bucket, key: call.key });
  }

  const result = await store.put("s3", object.body, {
    bucket: call.bucket,
    key: call.key,
    versionId: call.versionId ?? "",
    etag: object.etag ?? "",
    capturedAt,
  }).catch((error: unknown) => {
    throw new CaptureFailedError("failed to store S3 before image", { bucket: call.bucket, key: call.key, error: String(error) });
  });

  const digest = sha256(object.body);
  if (result.digest !== digest) {
    throw new CaptureFailedError("snapshot store returned a digest mismatch", { expected: digest, actual: result.digest });
  }

  return {
    digest,
    reference: result.reference,
    capturedAt,
    etag: object.etag,
    facts: [
      { name: "s3.capture.etag", value: object.etag ?? "", source: "captured", verifiedAt: capturedAt },
      { name: "s3.capture.versionId", value: object.versionId ?? "", source: "captured", verifiedAt: capturedAt },
    ],
  };
}

export function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
