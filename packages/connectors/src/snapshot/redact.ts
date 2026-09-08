import type { RedactionHook, SnapshotNamespace } from "./store.ts";

export async function identityRedaction(input: { readonly bytes: Uint8Array }): Promise<Uint8Array> {
  return input.bytes;
}

/**
 * Redaction happens before storage so the store never holds raw payload bytes.
 * The digest is computed after this function returns, over the redacted bytes.
 */
export async function applyRedaction(
  bytes: Uint8Array,
  hook: RedactionHook = identityRedaction,
  namespace: SnapshotNamespace = "default",
  metadata: Readonly<Record<string, string>> = {},
): Promise<Uint8Array> {
  return hook({ namespace, bytes, metadata });
}
