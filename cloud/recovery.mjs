import { recoveryRuntime } from "../packages/runtime/src/execute.ts";
import { digest, validateTransition } from "../packages/runtime/src/journal.ts";
import { VaultCapacityError } from "../packages/runtime/src/vault.ts";
import { managedDocumentAdapter } from "../packages/workbench/src/managed-documents.ts";
import {
  createWorkspace,
  previewWorkspaceUndo,
} from "../packages/workbench/src/workspace.ts";
import { read, write, encrypt, decrypt, ledger, append } from "./store.mjs";

const SLOT_BYTES = 4 * 1024 * 1024,
  CAPACITY = 64 * 1024 * 1024;
export const documentOperationId = (id) => digest(id);

/** Only managed documents: caller holds the session transaction lock. Artifacts,
 * signed events and document state commit together, including on process death.
 * Never use this transaction host for external tools or network side effects. */
export async function cloudDocumentRuntime(
  session,
  client,
  approvedBy = "web-operator",
) {
  const workspace = session.workspace;
  const proof = await ledger(workspace, client);
  const events = [];
  for (const entry of proof.entries) {
    if (entry.body.runtimeEvent) {
      validateTransition(events, entry.body.runtimeEvent);
      events.push(entry.body.runtimeEvent);
    }
  }
  const journal = {
    transaction: async (scope, run) => {
      if (scope !== workspace) throw new Error("Recovery workspace mismatch.");
      return run({
        events,
        append: async (event) => {
          if (event.workspace !== workspace)
            throw new Error("Recovery workspace mismatch.");
          validateTransition(events, event);
          const signed = await append(
            {
              workspace,
              at: event.at,
              tool: "void_recovery",
              klass: "r1",
              decision: `recovery:${event.stage}`,
              runtimeEvent: event,
            },
            client,
          );
          proof.entries.push(signed);
          events.push(event);
        },
      });
    },
  };
  const quotaKey = `recovery-quota:${session.id}`;
  const quota = (await read(quotaKey, client)) ?? { bytes: 0, slots: {} };
  const saveQuota = () => write(quotaKey, quota, client);
  const slotKey = (id, slot) => `${id}:${slot}`;
  const vault = {
    async reserve(scope, id, slots = ["capture", "outcome", "recovery"]) {
      if (scope !== workspace) throw new Error("Recovery workspace mismatch.");
      const missing = slots.filter((slot) => !quota.slots[slotKey(id, slot)]);
      if (quota.bytes + missing.length * SLOT_BYTES > CAPACITY)
        throw new VaultCapacityError("Cloud recovery quota exceeded.");
      for (const slot of missing)
        quota.slots[slotKey(id, slot)] = { reserved: true };
      quota.bytes += missing.length * SLOT_BYTES;
      await saveQuota();
    },
    async release(scope, id) {
      if (scope !== workspace) throw new Error("Recovery workspace mismatch.");
      for (const slot of ["capture", "outcome", "recovery"]) {
        const key = slotKey(id, slot);
        if (quota.slots[key]?.reserved) {
          delete quota.slots[key];
          quota.bytes -= SLOT_BYTES;
        }
      }
      await saveQuota();
    },
    async put(scope, value, allocation) {
      if (scope !== workspace || !allocation)
        throw new Error("Recovery allocation required.");
      const key = slotKey(allocation.operationId, allocation.slot);
      const bound = { workspace, value },
        hash = digest(bound);
      const previous = quota.slots[key];
      if (!previous) throw new Error("Missing recovery reservation.");
      if (!previous.reserved) {
        if (previous.digest !== hash)
          throw new Error("Recovery slot content changed.");
        return previous;
      }
      const encrypted = encrypt(bound),
        bytes = Buffer.byteLength(encrypted);
      if (bytes > SLOT_BYTES)
        throw new VaultCapacityError("Cloud recovery artifact exceeds quota.");
      const reference = { digest: hash, keyId: "cloud-v1", bytes };
      await write(`recovery-artifact:${session.id}:${hash}`, encrypted, client);
      quota.bytes += bytes - SLOT_BYTES;
      quota.slots[key] = reference;
      await saveQuota();
      return reference;
    },
    async get(scope, reference) {
      if (scope !== workspace || reference.keyId !== "cloud-v1")
        throw new Error("Recovery workspace or key mismatch.");
      const stored = await read(
        `recovery-artifact:${session.id}:${reference.digest}`,
        client,
      );
      if (!stored || Buffer.byteLength(stored) !== reference.bytes)
        throw new Error("Recovery artifact missing or changed.");
      const bound = decrypt(stored);
      if (bound.workspace !== workspace || digest(bound) !== reference.digest)
        throw new Error("Recovery artifact binding mismatch.");
      return bound.value;
    },
  };
  let state = await read(`workspace:${session.id}`, client);
  state = state ? decrypt(state) : createWorkspace();
  const adapter = managedDocumentAdapter({
    read: async () => state,
    verify: async (operation) =>
      proof.entries.some(
        (e) =>
          e.body.operationId === operation.id &&
          e.body.captureDigest === digest(operation) &&
          e.body.decision === "execute:completed",
      ),
    commit: async (transition, input) => {
      const signed = await append(
        {
          workspace,
          at: input.at,
          tool: input.name,
          klass: "r1",
          decision: "execute:completed",
          approvedBy,
          argsDigest: digest(input.arguments),
          operationId: transition.operation.id,
          captureDigest: digest(transition.operation),
          managedRuntimeOperationId: documentOperationId(
            input.arguments.operationId ?? input.id,
          ),
        },
        client,
      );
      proof.entries.push(signed);
      state = transition.state;
      await write(`workspace:${session.id}`, encrypt(state), client);
    },
  });
  const runtime = recoveryRuntime({
    journal,
    vault,
    adapters: [adapter],
    authorize: async () => true,
  });
  return { runtime, state: () => state };
}

export async function mutateCloudDocument(session, client, input, approvedBy) {
  const host = await cloudDocumentRuntime(session, client, approvedBy);
  const result = await host.runtime.execute({
    workspace: session.workspace,
    operationId: documentOperationId(input.id),
    agentId: approvedBy ?? "web-operator",
    runId: session.id,
    adapterId: "managed-documents",
    arguments: { ...input, at: input.at ?? new Date().toISOString() },
  });
  // Throw so the outer SQL transaction rolls back every state/artifact change.
  if (result.status !== "succeeded")
    throw new Error(`Managed document mutation ${result.status}.`);
  const state = host.state();
  return {
    state,
    result: result.result,
    operation: state.operations.find((op) => op.id === input.id),
  };
}

export async function managedCloudUndo(
  session,
  client,
  operationId,
  previewOnly = false,
) {
  const proof = await ledger(session.workspace, client);
  const marker = proof.entries.find(
    (e) =>
      e.body.operationId === operationId &&
      e.body.decision === "execute:completed",
  )?.body.managedRuntimeOperationId;
  if (!marker) return false; // Only genuinely legacy, unmarked records use legacy Undo.
  if (marker !== documentOperationId(operationId))
    throw new Error("Recovery marker mismatch.");
  const host = await cloudDocumentRuntime(session, client);
  const status = await host.runtime.status(session.workspace, marker);
  if (!status) throw new Error("Managed recovery evidence is missing.");
  const preview = previewWorkspaceUndo(host.state(), operationId);
  if (status === "restored") {
    await host.runtime.reconcileRecovery(session.workspace, marker);
    return true;
  }
  if (!preview.canApply) {
    if (previewOnly) return true;
    throw new Error("Document changed. Undo newer changes first.");
  }
  const plan = await host.runtime.planRecovery(session.workspace, marker);
  if (!previewOnly) {
    const result = await host.runtime.recover(plan, async () => true);
    if (result.status !== "restored")
      throw new Error(`Managed document recovery ${result.status}.`);
  }
  return true;
}
