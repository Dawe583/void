import type { Probe, ProbeCall, ProbeExecutor, ProbeResult } from "./registry.ts";

export const objectCountProbe: Probe = {
  id: "s3.object_count",
  async run(call: ProbeCall, exec: ProbeExecutor): Promise<ProbeResult> {
    try {
      const client = requireS3(exec);
      const input = parseS3Input(call.args);
      let radius = 0;
      let continuationToken: string | undefined;
      do {
        const page = await client.listObjectsV2({ bucket: input.bucket, prefix: input.prefix, continuationToken });
        radius += page.keyCount;
        continuationToken = page.nextContinuationToken;
      } while (continuationToken !== undefined);
      return { radius, note: input.prefix === undefined ? `bucket contains ${radius} objects` : `prefix ${input.prefix} contains ${radius} objects` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const versioningProbe: Probe = {
  id: "s3.versioning",
  async run(call: ProbeCall, exec: ProbeExecutor): Promise<ProbeResult> {
    try {
      const client = requireS3(exec);
      const input = parseS3Input(call.args);
      const state = await client.getBucketVersioning({ bucket: input.bucket });
      return {
        facts: {
          "bucket.versioning": state.status ?? "Suspended",
          "bucket.mfa_delete": state.mfaDelete ?? "off",
        },
        note: `bucket versioning is ${state.status ?? "Suspended"}`,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

function parseS3Input(args: Readonly<Record<string, unknown>>): { readonly bucket: string; readonly prefix: string | undefined } {
  const bucket = args.bucket ?? args.Bucket;
  const prefix = args.prefix ?? args.Prefix;
  if (typeof bucket !== "string" || bucket.length === 0) throw new Error("s3 probe requires string bucket");
  if (prefix !== undefined && typeof prefix !== "string") throw new Error("s3 probe prefix must be a string");
  return { bucket, prefix };
}

function requireS3(exec: ProbeExecutor): NonNullable<ProbeExecutor["s3"]> {
  if (exec.s3 === undefined) throw new Error("s3 probe requires s3 executor");
  return exec.s3;
}
