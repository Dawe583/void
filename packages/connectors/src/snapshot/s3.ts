import { applyRedaction } from "./redact.ts";
import { makeGetError, makePutError, sha256Digest, type RedactionHook, type RetentionPlan, type SnapshotStore } from "./store.ts";

export type S3PutObjectInput = {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
};

export type S3GetObjectInput = { readonly key: string };

export type S3LikeClient = {
  readonly putObject: (input: S3PutObjectInput) => Promise<void>;
  readonly getObject: (input: S3GetObjectInput) => Promise<Uint8Array>;
};

export type S3SnapshotStoreOptions = {
  readonly bucket?: string;
  readonly prefix?: string;
  readonly redaction?: RedactionHook;
};

/**
 * The real AWS client adapter belongs to WP-07 e2e. This module only depends
 * on the injected object shape, so tests never need network or aws-sdk.
 */
export function S3SnapshotStore(client: S3LikeClient, options: S3SnapshotStoreOptions = {}): SnapshotStore {
  const bucket = options.bucket ?? "snapshot";
  const prefix = trimSlashes(options.prefix ?? "void-snapshots");
  const redaction = options.redaction;

  return {
    async put(namespace, bytes, metadata = {}) {
      let redacted: Uint8Array;
      try {
        redacted = await applyRedaction(bytes, redaction, namespace, metadata);
      } catch (error) {
        throw makePutError("RedactionFailed", namespace, "snapshot redaction failed", error);
      }
      const digest = sha256Digest(redacted);
      const key = keyFor(prefix, namespace, digest);
      try {
        await client.putObject({ key, bytes: redacted, metadata });
      } catch (error) {
        throw makePutError("WriteFailed", namespace, "snapshot write failed", error);
      }
      return { digest, reference: { namespace, digest, uri: `s3://${bucket}/${key}` } };
    },

    async get(reference) {
      const key = keyFor(prefix, reference.namespace, reference.digest);
      let bytes: Uint8Array;
      try {
        bytes = await client.getObject({ key });
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
      return {
        namespace,
        retainedBytes: 0,
        deleteOlderThan: async () => ({ deleted: 0, freedBytes: 0, errors: [] }),
      } satisfies RetentionPlan;
    },
  } satisfies SnapshotStore;
}

function keyFor(prefix: string, namespace: string, digest: `sha256:${string}`): string {
  const namespacePart = encodeURIComponent(namespace);
  const digestPart = digest.slice("sha256:".length);
  return prefix.length === 0 ? `${namespacePart}/${digestPart}` : `${prefix}/${namespacePart}/${digestPart}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
