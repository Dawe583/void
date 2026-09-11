/**
 * Probe failures deliberately omit the related fact. Unknown stays absent so the
 * registry precondition does not match and the ordered fallback denies or holds.
 */

export type S3DeleteCall = {
  readonly bucket: string;
  readonly key: string;
  readonly versionId?: string;
};

export type S3GetObjectInput = S3DeleteCall;

export type S3GetObjectResult = {
  readonly body?: Uint8Array;
  readonly etag?: string;
  readonly versionId?: string;
  readonly deleteMarker?: boolean;
};

export type S3BucketVersioningResult = {
  readonly status?: "Enabled" | "Suspended" | "Disabled";
  readonly mfaDelete?: "Enabled" | "Disabled" | "on" | "off";
};

export type S3Client = {
  readonly getObject: (input: S3GetObjectInput) => Promise<S3GetObjectResult>;
  readonly putObject: (input: { readonly bucket: string; readonly key: string; readonly body: Uint8Array; readonly ifMatch?: string; readonly ifNoneMatch?: string }) => Promise<{ readonly etag?: string; readonly versionId?: string }>;
  readonly deleteObject: (input: S3DeleteCall) => Promise<{ readonly versionId?: string; readonly deleteMarker?: boolean }>;
  readonly getBucketVersioning: (input: { readonly bucket: string }) => Promise<S3BucketVersioningResult>;
};

export type ConnectorFact = {
  readonly name: string;
  readonly value: string | boolean;
  readonly source: "declared" | "captured" | "probed" | "derived";
  readonly verifiedAt: string;
};

export class ProbeError extends Error {
  readonly kind = "ProbeError";
  readonly probe: string;
  readonly causeValue: unknown;

  constructor(probe: string, causeValue: unknown) {
    super(`S3 probe failed: ${probe}`);
    this.name = "ProbeError";
    this.probe = probe;
    this.causeValue = causeValue;
  }
}

export type S3FactsResult = {
  readonly facts: readonly ConnectorFact[];
  readonly errors: readonly ProbeError[];
};

function mfaDeleteValue(value: S3BucketVersioningResult["mfaDelete"]): "on" | "off" {
  return value === "Enabled" || value === "on" ? "on" : "off";
}

function versioningValue(value: S3BucketVersioningResult["status"]): "Enabled" | "Suspended" | "Disabled" {
  return value ?? "Disabled";
}

export async function s3Facts(call: S3DeleteCall, client: S3Client, now: () => Date = () => new Date()): Promise<S3FactsResult> {
  const facts: ConnectorFact[] = [];
  const errors: ProbeError[] = [];

  const verifiedAt = now().toISOString();

  try {
    const versioning = await client.getBucketVersioning({ bucket: call.bucket });
    facts.push({ name: "bucket.versioning", value: versioningValue(versioning.status), source: "probed", verifiedAt });
    facts.push({ name: "bucket.mfa_delete", value: mfaDeleteValue(versioning.mfaDelete), source: "probed", verifiedAt });
  } catch (error: unknown) {
    errors.push(new ProbeError("getBucketVersioning", error));
  }

  try {
    await client.getObject({ bucket: call.bucket, key: call.key, versionId: call.versionId });
    facts.push({ name: "s3.key.existed", value: "true", source: "probed", verifiedAt });
  } catch (error: unknown) {
    if (isNotFound(error)) {
      facts.push({ name: "s3.key.existed", value: "false", source: "probed", verifiedAt });
    } else {
      errors.push(new ProbeError("getObject", error));
    }
  }

  facts.push({ name: "argument.versionId", value: call.versionId === undefined ? "absent" : "present", source: "derived", verifiedAt });
  return { facts, errors };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Readonly<Record<string, unknown>>;
  return record.name === "NoSuchKey" || record.code === "NoSuchKey" || record.statusCode === 404;
}
