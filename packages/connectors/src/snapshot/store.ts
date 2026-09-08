import { createHash } from "node:crypto";

export type ConnectorId = string;
export type RegistryEntryId = string;
export type SnapshotNamespace = string;
export type SnapshotReference = { readonly namespace: string; readonly digest: `sha256:${string}`; readonly uri: string };
export type SnapshotPutResult = { readonly digest: `sha256:${string}`; readonly reference: SnapshotReference };
export type RetentionReport = { readonly deleted: number; readonly freedBytes: number; readonly errors: readonly string[] };
export type RetentionPlan = { readonly namespace: SnapshotNamespace; readonly retainedBytes: number; readonly deleteOlderThan: (cutoff: Date) => Promise<RetentionReport> };
export type RedactionHook = (input: { readonly namespace: SnapshotNamespace; readonly bytes: Uint8Array; readonly metadata: Readonly<Record<string, string>> }) => Promise<Uint8Array>;
export type SnapshotStore = { readonly put: (namespace: SnapshotNamespace, bytes: Uint8Array, metadata?: Readonly<Record<string, string>>) => Promise<SnapshotPutResult>; readonly get: (reference: SnapshotReference) => Promise<Uint8Array>; readonly retention: (namespace: SnapshotNamespace) => Promise<RetentionPlan> };

export type PutErrorKind = "RedactionFailed" | "WriteFailed" | "RetentionFailed" | "InvalidNamespace" | "InternalError";
export type GetErrorKind = "SnapshotUnavailable" | "DigestMismatch" | "ReadFailed" | "InvalidReference" | "InternalError";

export type PutError = Error & {
  readonly kind: PutErrorKind;
  readonly namespace: SnapshotNamespace;
  readonly retryable: boolean;
  readonly cause: unknown;
};

export type GetError = Error & {
  readonly kind: GetErrorKind;
  readonly reference: SnapshotReference;
  readonly retryable: boolean;
  readonly cause: unknown;
};

export function sha256Digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function makePutError(kind: PutErrorKind, namespace: SnapshotNamespace, message: string, cause?: unknown): PutError {
  return Object.assign(new Error(message), { kind, namespace, retryable: kind === "WriteFailed" || kind === "RetentionFailed", cause });
}

export function makeGetError(kind: GetErrorKind, reference: SnapshotReference, message: string, cause?: unknown): GetError {
  return Object.assign(new Error(message), { kind, reference, retryable: kind === "SnapshotUnavailable" || kind === "ReadFailed", cause });
}
