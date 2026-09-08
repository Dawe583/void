import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { objectCountProbe, versioningProbe } from "./s3.ts";
import type { ProbeExecutor } from "./registry.ts";

describe("s3 probes", () => {
  test("object count probe counts paged prefix results", async () => {
    const seen: Array<string | undefined> = [];
    const exec: ProbeExecutor = {
      s3: {
        async listObjectsV2(input) {
          seen.push(input.continuationToken);
          if (input.continuationToken === undefined) return { keyCount: 2, nextContinuationToken: "next" };
          return { keyCount: 3 };
        },
        async getBucketVersioning() {
          return {};
        },
      },
    };

    const result = await objectCountProbe.run({ tool: "aws.s3.object.delete", args: { bucket: "b", prefix: "logs/" } }, exec);

    assert.deepEqual(result, { radius: 5, note: "prefix logs/ contains 5 objects" });
    assert.deepEqual(seen, [undefined, "next"]);
  });

  test("versioning probe returns registry fact names", async () => {
    const exec: ProbeExecutor = {
      s3: {
        async listObjectsV2() {
          return { keyCount: 0 };
        },
        async getBucketVersioning() {
          return { status: "Enabled", mfaDelete: "off" };
        },
      },
    };

    const result = await versioningProbe.run({ tool: "aws.s3.object.delete", args: { bucket: "b" } }, exec);

    assert.deepEqual(result, { facts: { "bucket.versioning": "Enabled", "bucket.mfa_delete": "off" }, note: "bucket versioning is Enabled" });
  });
});
