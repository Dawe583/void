import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LocalSnapshotStore } from "./local.ts";
import { applyRedaction } from "./redact.ts";
import { S3SnapshotStore, type S3LikeClient } from "./s3.ts";
import { sha256Digest } from "./store.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "void-snapshots-"));
}

describe("snapshot stores", () => {
  test("local store round trips bytes and returns a stable digest", async () => {
    const root = await tempRoot();
    try {
      const store = LocalSnapshotStore(root);
      const bytes = encoder.encode("payload");
      const first = await store.put("pg", bytes);
      const second = await store.put("pg", bytes);

      assert.equal(first.digest, sha256Digest(bytes));
      assert.equal(second.digest, first.digest);
      assert.equal(decoder.decode(await store.get(first.reference)), "payload");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("local store evicts oldest snapshots first when the byte budget is exceeded", async () => {
    const root = await tempRoot();
    try {
      const store = LocalSnapshotStore(root, { maxBytes: 8 });
      const oldest = await store.put("pg", encoder.encode("aaaa"));
      const kept = await store.put("pg", encoder.encode("bbbb"));
      const oldDate = new Date("2020-01-01T00:00:00.000Z");
      const newerDate = new Date("2020-01-02T00:00:00.000Z");
      await utimes(filePath(root, oldest.reference.namespace, oldest.digest), oldDate, oldDate);
      await utimes(filePath(root, kept.reference.namespace, kept.digest), newerDate, newerDate);

      const newest = await store.put("pg", encoder.encode("cccc"));

      await assert.rejects(() => store.get(oldest.reference), /snapshot is unavailable/);
      assert.equal(decoder.decode(await store.get(kept.reference)), "bbbb");
      assert.equal(decoder.decode(await store.get(newest.reference)), "cccc");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("local store ignores crash leftovers and never treats tmp bytes as snapshots", async () => {
    const root = await tempRoot();
    try {
      const store = LocalSnapshotStore(root);
      const tmpDir = join(root, encodeURIComponent("pg"));
      await mkdir(tmpDir, { recursive: true });
      await writeFile(join(tmpDir, ".tmp-dead-process"), encoder.encode("partial"));
      const partialDigest = sha256Digest(encoder.encode("partial"));
      await assert.rejects(
        () => store.get({ namespace: "pg", digest: partialDigest, uri: "file://partial" }),
        /snapshot is unavailable/,
      );

      const stored = await store.put("pg", encoder.encode("complete"));
      assert.equal(decoder.decode(await store.get(stored.reference)), "complete");
      const retention = await store.retention("pg");
      assert.equal(retention.retainedBytes, encoder.encode("complete").byteLength);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("redaction runs before storage and the digest covers redacted bytes", async () => {
    const root = await tempRoot();
    try {
      const redacted = encoder.encode("token=masked");
      const store = LocalSnapshotStore(root, {
        redaction: async ({ namespace, bytes }) => {
          assert.equal(namespace, "pg");
          assert.equal(decoder.decode(bytes), "token=secret");
          return redacted;
        },
      });

      const result = await store.put("pg", encoder.encode("token=secret"));

      assert.equal(result.digest, sha256Digest(redacted));
      assert.equal(decoder.decode(await readFile(filePath(root, "pg", result.digest))), "token=masked");
      assert.equal(decoder.decode(await store.get(result.reference)), "token=masked");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("applyRedaction defaults to identity", async () => {
    const bytes = encoder.encode("unchanged");
    assert.equal(await applyRedaction(bytes), bytes);
  });

  test("s3 store uses an injected client, round trips bytes, and verifies digest", async () => {
    const objects = new Map<string, Uint8Array>();
    const client: S3LikeClient = {
      async putObject(input) {
        objects.set(input.key, input.bytes);
      },
      async getObject(input) {
        const value = objects.get(input.key);
        if (value === undefined) {
          throw new Error("missing object");
        }
        return value;
      },
    };
    const store = S3SnapshotStore(client, { bucket: "customer", prefix: "prefix" });
    const result = await store.put("s3", encoder.encode("object"));

    assert.equal(result.digest, sha256Digest(encoder.encode("object")));
    assert.equal(result.reference.uri, `s3://customer/prefix/s3/${result.digest.slice("sha256:".length)}`);
    assert.equal(decoder.decode(await store.get(result.reference)), "object");
  });

  test("s3 store redacts before upload and the digest covers uploaded bytes", async () => {
    let uploaded: Uint8Array | undefined;
    const client: S3LikeClient = {
      async putObject(input) {
        uploaded = input.bytes;
      },
      async getObject() {
        if (uploaded === undefined) {
          throw new Error("missing object");
        }
        return uploaded;
      },
    };
    const masked = encoder.encode("masked");
    const store = S3SnapshotStore(client, { redaction: async () => masked });
    const result = await store.put("s3", encoder.encode("secret"));

    assert.equal(result.digest, sha256Digest(masked));
    assert.equal(decoder.decode(await store.get(result.reference)), "masked");
  });
});

function filePath(root: string, namespace: string, digest: `sha256:${string}`): string {
  return join(root, encodeURIComponent(namespace), digest.slice("sha256:".length));
}
