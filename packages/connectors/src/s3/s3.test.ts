import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyRestore } from "./apply.ts";
import { captureObject, sha256 } from "./capture.ts";
import { LocalSnapshotStore } from "../snapshot/local.ts";
import { restoreObject } from "./inverse.ts";
import { s3Facts, type S3Client, type S3DeleteCall, type S3GetObjectResult } from "./classify.ts";

type StoredObject = { readonly body: Uint8Array; readonly etag: string; readonly versionId?: string };

class FakeS3Client implements S3Client {
  versioning: "Enabled" | "Suspended" | "Disabled" = "Disabled";
  mfaDelete: "Enabled" | "Disabled" | "on" | "off" = "Disabled";
  readonly objects = new Map<string, StoredObject>();
  nextVersion = 1;

  async getBucketVersioning(_input: { readonly bucket: string }): Promise<{ readonly status: "Enabled" | "Suspended" | "Disabled"; readonly mfaDelete: "Enabled" | "Disabled" | "on" | "off" }> {
    return { status: this.versioning, mfaDelete: this.mfaDelete };
  }

  async getObject(input: S3DeleteCall): Promise<S3GetObjectResult> {
    const stored = this.objects.get(objectKey(input));
    if (stored === undefined) {
      const error = new Error("missing key") as Error & { code: string; statusCode: number };
      error.code = "NoSuchKey";
      error.statusCode = 404;
      throw error;
    }
    return { body: new Uint8Array(stored.body), etag: stored.etag, versionId: stored.versionId };
  }

  async putObject(input: { readonly bucket: string; readonly key: string; readonly body: Uint8Array }): Promise<{ readonly etag: string; readonly versionId?: string }> {
    const etag = quotedHex(input.body);
    const versionId = this.versioning === "Enabled" ? `v${this.nextVersion++}` : undefined;
    this.objects.set(objectKey(input), { body: new Uint8Array(input.body), etag, versionId });
    return { etag, versionId };
  }

  async deleteObject(input: S3DeleteCall): Promise<{ readonly versionId?: string; readonly deleteMarker?: boolean }> {
    this.objects.delete(objectKey(input));
    return { versionId: this.versioning === "Enabled" ? `v${this.nextVersion++}` : undefined, deleteMarker: this.versioning === "Enabled" };
  }
}

function objectKey(input: { readonly bucket: string; readonly key: string }): string {
  return `${input.bucket}/${input.key}`;
}

function quotedHex(bytes: Uint8Array): string {
  return `"${Buffer.from(bytes).toString("hex")}"`;
}

describe("s3Facts", () => {
  test("maps versioning, object existence, and versionId facts", async () => {
    const client = new FakeS3Client();
    client.versioning = "Enabled";
    client.mfaDelete = "Disabled";
    await client.putObject({ bucket: "b", key: "k", body: new TextEncoder().encode("before") });

    const result = await s3Facts({ bucket: "b", key: "k", versionId: "v1" }, client, () => new Date("2026-09-08T00:00:00Z"));

    assert.deepEqual(result.errors, []);
    assert.equal(fact(result.facts, "bucket.versioning"), "Enabled");
    assert.equal(fact(result.facts, "bucket.mfa_delete"), "off");
    assert.equal(fact(result.facts, "s3.key.existed"), "true");
    assert.equal(fact(result.facts, "argument.versionId"), "present");
  });

  test("maps missing keys and disabled versioning", async () => {
    const client = new FakeS3Client();

    const result = await s3Facts({ bucket: "b", key: "missing" }, client);

    assert.equal(fact(result.facts, "bucket.versioning"), "Disabled");
    assert.equal(fact(result.facts, "s3.key.existed"), "false");
    assert.equal(fact(result.facts, "argument.versionId"), "absent");
  });

  test("omits unknown facts when a probe fails", async () => {
    const client = new FakeS3Client();
    const failing: S3Client = {
      getBucketVersioning: async (input) => client.getBucketVersioning(input),
      putObject: async (input) => client.putObject(input),
      deleteObject: async (input) => client.deleteObject(input),
      getObject: async () => {
        throw new Error("access denied");
      },
    };

    const result = await s3Facts({ bucket: "b", key: "k" }, failing);

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.probe, "getObject");
    assert.equal(result.facts.some((item) => item.name === "s3.key.existed"), false);
  });
});

describe("S3 capture, inverse, and apply", () => {
  test("captures bytes through a snapshot store", async () => {
    const client = new FakeS3Client();
    const store = await localSnapshotStore();
    const bytes = new TextEncoder().encode("before");
    await client.putObject({ bucket: "b", key: "k", body: bytes });

    const captured = await captureObject(store, client, { bucket: "b", key: "k" }, () => new Date("2026-09-08T00:00:00Z"));

    assert.equal(captured.digest, sha256(bytes));
    assert.deepEqual([...await store.get(captured.reference)], [...bytes]);
    assert.equal(captured.capturedAt, "2026-09-08T00:00:00.000Z");
  });

  test("restores captured bytes", async () => {
    const client = new FakeS3Client();
    await restoreObject(client, { bucket: "b", key: "k" }, { bytes: new TextEncoder().encode("restored") });

    const restored = await client.getObject({ bucket: "b", key: "k" });

    assert.equal(new TextDecoder().decode(restored.body), "restored");
  });

  test("refuses to restore when etag drift is detected", async () => {
    const client = new FakeS3Client();
    const store = await localSnapshotStore();
    const before = new TextEncoder().encode("before");
    await client.putObject({ bucket: "b", key: "k", body: before });
    const captured = await captureObject(store, client, { bucket: "b", key: "k" });
    await client.putObject({ bucket: "b", key: "k", body: new TextEncoder().encode("human change") });

    const report = await applyRestore(store, client, { stepId: "restore-1", call: { bucket: "b", key: "k" }, reference: captured.reference, capturedEtag: captured.etag });

    assert.deepEqual(report.applied, []);
    assert.equal(report.refused[0]?.reason, "drift");
    assert.equal((await client.getObject({ bucket: "b", key: "k" })).etag, quotedHex(new TextEncoder().encode("human change")));
  });

  test("restores when current target is absent", async () => {
    const client = new FakeS3Client();
    const store = await localSnapshotStore();
    await client.putObject({ bucket: "b", key: "k", body: new TextEncoder().encode("before") });
    const captured = await captureObject(store, client, { bucket: "b", key: "k" });
    await client.deleteObject({ bucket: "b", key: "k" });

    const report = await applyRestore(store, client, { stepId: "restore-1", call: { bucket: "b", key: "k" }, reference: captured.reference, capturedEtag: captured.etag });

    assert.deepEqual(report, { applied: ["restore-1"], refused: [] });
    assert.equal(new TextDecoder().decode((await client.getObject({ bucket: "b", key: "k" })).body), "before");
  });
});

async function localSnapshotStore(): Promise<ReturnType<typeof LocalSnapshotStore>> {
  const root = await mkdtemp(join(tmpdir(), "void-s3-snapshot-"));
  const store = LocalSnapshotStore(root);
  test.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return store;
}

function fact(facts: readonly { readonly name: string; readonly value: string | boolean }[], name: string): string | boolean | undefined {
  return facts.find((item) => item.name === name)?.value;
}
