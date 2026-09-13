/** Cooperative workspace only: Node has no atomic compare-and-replace for paths.
 * The operator must exclude concurrent writers during dispatch and Undo. Every
 * observed edit conflicts; bytes/mode are restored, not inode, ACL or xattrs.
 */
import {
  constants,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  fchmodSync,
  renameSync,
  unlinkSync,
  linkSync,
} from "node:fs";
import { resolve, join, dirname, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Json, RecoveryAdapter, Prepared } from "../recovery.ts";

type Mutation = {
  action: "write" | "delete";
  path: string;
  base64?: string;
  mode?: number;
};
type Snapshot = { bytes: string | null; mode: number; revision: string };
type Capture = { path: string; snapshot: Snapshot };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const maxBytes = 1024 * 1024;
export function managedFilesystemAdapter(options: {
  root: string;
  cooperative: true;
}): RecoveryAdapter {
  if (options.cooperative !== true)
    throw new Error("Explicit cooperative workspace ownership is required.");
  const root = realpathSync(resolve(options.root));
  const rootStat = lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory())
    throw new Error("Workspace must be a directory.");
  const identity = `${rootStat.dev}:${rootStat.ino}`;
  function target(path: string) {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 1024 ||
      isAbsolute(path) ||
      path.includes("\\") ||
      path.includes("\0")
    )
      throw new Error("Invalid workspace path.");
    const parts = path.split("/");
    if (
      parts.some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /^(\.git|\.ssh|\.aws|\.env.*|\.void.*)$/i.test(p),
      )
    )
      throw new Error("Protected or invalid workspace path.");
    const current = lstatSync(root, { bigint: true });
    if (!current.isDirectory() || `${current.dev}:${current.ino}` !== identity)
      throw new Error("Workspace identity changed.");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Unsafe workspace parent.");
    }
    return join(root, path);
  }
  function parse(args: Json): Mutation {
    if (
      !args ||
      Array.isArray(args) ||
      typeof args !== "object" ||
      Object.keys(args).some(
        (k) => !["action", "path", "base64", "mode"].includes(k),
      )
    )
      throw new Error("Invalid file mutation.");
    const value = args as unknown as Mutation;
    target(value.path);
    if (!["write", "delete"].includes(value.action))
      throw new Error("Unsupported file action.");
    if (value.action === "write") {
      if (
        typeof value.base64 !== "string" ||
        value.base64.length > Math.ceil(maxBytes / 3) * 4 ||
        Buffer.from(value.base64, "base64").toString("base64") !==
          value.base64 ||
        Buffer.from(value.base64, "base64").length > maxBytes
      )
        throw new Error("Expected canonical base64 up to 1 MiB.");
      if (
        value.mode !== undefined &&
        (!Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777)
      )
        throw new Error("Invalid file mode.");
    } else if (value.base64 !== undefined || value.mode !== undefined)
      throw new Error("Delete accepts only a path.");
    return value;
  }
  function snapshot(path: string): Snapshot {
    const absolute = target(path);
    let fd: number;
    try {
      fd = openSync(
        absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = lstatSync(dirname(absolute), { bigint: true });
      return {
        bytes: null,
        mode: 0,
        revision: hash([
          "absent",
          String(parent.dev),
          String(parent.ino),
          String(parent.ctimeNs),
        ]),
      };
    }
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (
        !stat.isFile() ||
        stat.nlink !== 1n ||
        stat.size > BigInt(maxBytes) ||
        (stat.mode & 0o7000n) !== 0n
      )
        throw new Error(
          "Only regular, single-link files up to 1 MiB are supported.",
        );
      // Bound reads even when a non-cooperating process grows the file.
      const bytes = Buffer.alloc(maxBytes + 1);
      const count = readSync(fd, bytes, 0, bytes.length, 0);
      if (count > maxBytes) throw new Error("File exceeded capture limit.");
      const after = fstatSync(fd, { bigint: true });
      if (
        BigInt(count) !== stat.size ||
        stat.ctimeNs !== after.ctimeNs ||
        stat.size !== after.size
      )
        throw new Error("File changed during capture.");
      const encoded = bytes.subarray(0, count).toString("base64"),
        mode = Number(stat.mode & 0o777n);
      return {
        bytes: encoded,
        mode,
        revision: hash([
          encoded,
          mode,
          String(stat.dev),
          String(stat.ino),
          String(stat.ctimeNs),
          String(stat.uid),
          String(stat.gid),
        ]),
      };
    } finally {
      closeSync(fd);
    }
  }
  function syncDirectory(path: string) {
    const fd = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  function replace(
    path: string,
    expected: Snapshot,
    bytes: string | null,
    mode: number,
  ) {
    const absolute = target(path);
    if (snapshot(path).revision !== expected.revision)
      throw new Error("File revision conflict.");
    if (bytes === null) {
      if (expected.bytes !== null) unlinkSync(absolute);
    } else {
      const temporary = join(dirname(absolute), `.void-${randomUUID()}`);
      const fd = openSync(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        try {
          writeFileSync(fd, Buffer.from(bytes, "base64"));
          fchmodSync(fd, mode);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        // The temp file changes the parent ctime, so absent targets use link's no-clobber guarantee.
        if (expected.bytes === null) {
          target(path);
          linkSync(temporary, absolute);
        } else {
          if (snapshot(path).revision !== expected.revision)
            throw new Error("File revision conflict.");
          renameSync(temporary, absolute);
        }
      } finally {
        try {
          unlinkSync(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    syncDirectory(absolute);
    const after = snapshot(path);
    if (after.bytes !== bytes || (bytes !== null && after.mode !== mode))
      throw new Error("File verification failed.");
    return after;
  }
  const capture = (prepared: Prepared) => prepared.before as unknown as Capture;
  return {
    id: "filesystem.managed",
    version: "1",
    async preflight(args) {
      const mutation = parse(args),
        before = snapshot(mutation.path);
      if (mutation.action === "delete" && before.bytes === null)
        throw new Error("File does not exist.");
      return {
        effect: "write",
        reversibility: "r1",
        readiness: "verified",
        scope:
          "Cooperative filesystem: one path, bytes and POSIX mode only. No concurrent external writer, inode, ACL, xattr or shell guarantee.",
        resources: [`file:${join(root, mutation.path)}`],
        revision: before.revision,
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare(args, observation) {
      const mutation = parse(args),
        before = snapshot(mutation.path);
      if (observation.revision !== before.revision)
        throw new Error("File revision conflict.");
      return {
        before: { path: mutation.path, snapshot: before } as unknown as Json,
        plan: { mutation, root, identity } as unknown as Json,
      };
    },
    async execute(args, prepared) {
      const mutation = parse(args),
        before = capture(prepared);
      const plan = prepared.plan as {
        root: string;
        identity: string;
        mutation: Json;
      };
      if (
        plan.root !== root ||
        plan.identity !== identity ||
        hash(plan.mutation) !== hash(mutation) ||
        before.path !== mutation.path
      )
        throw new Error("File capture binding mismatch.");
      const after = replace(
        mutation.path,
        before.snapshot,
        mutation.action === "delete" ? null : mutation.base64!,
        mutation.mode ??
          (before.snapshot.bytes === null ? 0o644 : before.snapshot.mode),
      );
      return {
        result: { path: mutation.path, action: mutation.action },
        evidence: { revision: after.revision },
      };
    },
    async release() {},
    // Filesystem and journal cannot commit atomically. State equality is not a durable receipt.
    async reconcile() {
      return { status: "unknown" };
    },
    async reconcileRecovery() {
      return { status: "unknown" };
    },
    async recover(prepared, outcome) {
      const before = capture(prepared),
        plan = prepared.plan as { root: string; identity: string };
      if (plan.root !== root || plan.identity !== identity)
        return { status: "conflict", evidence: null };
      let current: Snapshot;
      try {
        current = snapshot(before.path);
      } catch {
        return { status: "conflict", evidence: null };
      }
      if (
        current.revision !== (outcome.evidence as { revision: string }).revision
      )
        return { status: "conflict", evidence: null };
      const restored = replace(
        before.path,
        current,
        before.snapshot.bytes,
        before.snapshot.mode,
      );
      return {
        status: "restored",
        evidence: {
          path: before.path,
          revision: restored.revision,
          scope: "bytes-and-mode",
        },
      };
    },
  };
}
