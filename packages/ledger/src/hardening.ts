import { lstat } from "node:fs/promises";

const WORKSPACE_PATTERN = /^[a-z0-9._-]+$/;

export function sanitizeWorkspace(workspace: string): string {
  if (!WORKSPACE_PATTERN.test(workspace) || workspace === "." || workspace === "..") {
    throw new TypeError("workspace must match [a-z0-9._-]+ and stay within one file name");
  }
  return workspace;
}

export async function assertPrivateKeyFileMode(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) {
    throw new Error("development key file must not be a symbolic link");
  }
  if (!info.isFile()) {
    throw new Error("development key path must be a regular file");
  }
  const mode = info.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`development key file must have permissions 0600, got ${mode.toString(8).padStart(4, "0")}`);
  }
}
