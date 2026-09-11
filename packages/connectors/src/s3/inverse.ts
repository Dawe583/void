import type { S3Client, S3DeleteCall } from "./classify.ts";

export type S3ObjectImage = {
  readonly bytes: Uint8Array;
  readonly etag?: string;
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
};

export type RestoreObjectReport = {
  readonly etag?: string;
  readonly versionId?: string;
  readonly note: string;
};

export async function restoreObject(client: S3Client, call: S3DeleteCall, image: S3ObjectImage): Promise<RestoreObjectReport> {
  const result = await client.putObject({ bucket: call.bucket, key: call.key, body: image.bytes, ...(image.ifMatch ? { ifMatch: image.ifMatch } : {}), ...(image.ifNoneMatch ? { ifNoneMatch: image.ifNoneMatch } : {}) });
  return {
    etag: result.etag,
    versionId: result.versionId,
    note: "For versioned buckets this writes a new version. A true inverse that removes the delete marker is impossible without the marker version id, so the data returns while the marker may remain.",
  };
}
