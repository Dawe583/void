import {
  digest,
  type RecoveryAdapter,
  type Json,
  type Prepared,
  type Outcome,
} from "../../runtime/src/index.ts";
import {
  executeWorkspaceTool,
  applyWorkspaceUndo,
  previewWorkspaceUndo,
  type WorkspaceState,
  type WorkspaceOperation,
  type WorkspaceTransition,
} from "./workspace.ts";

type Input = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  at: string;
};
/** Host must serialize this adapter with all document edits and atomically persist
 * transitions with signed operation evidence. Existing document format is retained. */
export function managedDocumentAdapter(host: {
  read(): Promise<WorkspaceState>;
  verify(operation: WorkspaceOperation): Promise<boolean>;
  commit(transition: WorkspaceTransition, input: Input): Promise<void>;
}): RecoveryAdapter {
  const parse = (value: Json): Input => {
    const input = value as unknown as Input;
    if (
      !input ||
      !["void_workspace_write", "void_workspace_delete"].includes(input.name) ||
      typeof input.id !== "string" ||
      typeof input.at !== "string" ||
      !input.arguments ||
      typeof input.arguments !== "object" ||
      Array.isArray(input.arguments)
    )
      throw new Error("Expected a managed document mutation.");
    return input;
  };
  const transition = (state: WorkspaceState, input: Input) => {
    const next = executeWorkspaceTool(state, input);
    if (next.result.isError || !next.operation)
      throw new Error(
        next.result.content[0]?.text ?? "Invalid document mutation.",
      );
    return next;
  };
  const revision = (state: WorkspaceState, path: string) =>
    digest({
      content: state.files[path] ?? null,
      last:
        [...state.operations].reverse().find((op) => op.path === path)?.id ??
        null,
    });
  const plan = (prepared: Prepared) =>
    prepared.plan as unknown as {
      input: Input;
      operation: WorkspaceOperation;
      revision: string;
    };
  const bound = (prepared: Prepared, outcome?: Outcome) => {
    const p = plan(prepared);
    if (
      prepared.before !== p.operation.before ||
      (outcome && digest(outcome.evidence) !== digest(p.operation))
    )
      throw new Error("Document capture binding mismatch.");
    return p;
  };
  const confirmed = async (state: WorkspaceState, prepared: Prepared) => {
    const p = bound(prepared),
      found = state.operations.find((op) => op.id === p.operation.id);
    if (
      found &&
      (digest(found) !== digest(p.operation) || !(await host.verify(found)))
    )
      throw new Error("Document operation does not match signed evidence.");
    return found;
  };
  return {
    id: "managed-documents",
    version: "1",
    async preflight(args) {
      const input = parse(args),
        state = await host.read(),
        next = transition(state, input),
        path = next.operation!.path;
      return {
        effect: "write",
        reversibility: "r1",
        readiness: "verified",
        scope:
          "Managed text document content and operation history; no host filesystem or external effects.",
        resources: ["document:" + path],
        revision: revision(state, path),
        blastRadius: { count: 1, precision: "exact" },
      };
    },
    async prepare(args, observation) {
      const input = parse(args),
        state = await host.read(),
        next = transition(state, input),
        operation = next.operation!;
      if (revision(state, operation.path) !== observation.revision)
        throw new Error("Document changed during preparation.");
      return {
        before: operation.before,
        plan: {
          input,
          operation,
          revision: observation.revision,
        } as unknown as Json,
      };
    },
    async execute(args, prepared) {
      const p = bound(prepared),
        input = parse(args),
        state = await host.read();
      if (
        digest(input) !== digest(p.input) ||
        revision(state, p.operation.path) !== p.revision
      )
        throw new Error("Document changed before dispatch.");
      const next = transition(state, input);
      if (digest(next.operation) !== digest(p.operation))
        throw new Error("Prepared document differs from mutation.");
      await host.commit(next, input);
      return {
        result: next.result as unknown as Json,
        evidence: next.operation as unknown as Json,
      };
    },
    async release() {},
    async reconcile(_id, prepared) {
      const found = await confirmed(await host.read(), prepared);
      return found
        ? {
            status: "succeeded",
            outcome: {
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      operationId: found.id,
                      path: found.path,
                      action: found.kind,
                      completed: true,
                      undoAvailable: true,
                    }),
                  },
                ],
              },
              evidence: found as unknown as Json,
            },
          }
        : { status: "unknown" };
    },
    async recover(prepared, outcome, recoveryId) {
      const p = bound(prepared, outcome),
        state = await host.read();
      if (!(await confirmed(state, prepared)))
        throw new Error("Original document receipt is absent.");
      const existing = state.operations.find((op) => op.id === recoveryId);
      if (existing) {
        if (
          existing.undoes !== p.operation.id ||
          !(await host.verify(existing))
        )
          throw new Error("Recovery receipt mismatch.");
        return { status: "restored", evidence: existing as unknown as Json };
      }
      const preview = previewWorkspaceUndo(state, p.operation.id);
      if (!preview.canApply)
        return {
          status: "conflict",
          evidence: {
            path: p.operation.path,
            reason: preview.reason ?? "Document changed.",
          },
        };
      const next = applyWorkspaceUndo(state, {
        id: recoveryId,
        operationId: p.operation.id,
      });
      if (next.result.isError || !next.operation)
        throw new Error("Document recovery failed.");
      await host.commit(next, {
        id: recoveryId,
        name: "void_workspace_undo",
        arguments: { operationId: p.operation.id },
        at: next.operation.at,
      });
      return {
        status: "restored",
        evidence: next.operation as unknown as Json,
      };
    },
    async reconcileRecovery(prepared, outcome, recoveryId) {
      const p = bound(prepared, outcome),
        state = await host.read();
      if (!(await confirmed(state, prepared)))
        throw new Error("Original document receipt is absent.");
      const found = state.operations.find((op) => op.id === recoveryId);
      if (!found) return { status: "unknown" };
      if (found.undoes !== p.operation.id || !(await host.verify(found)))
        throw new Error("Recovery receipt mismatch.");
      return { status: "restored", evidence: found as unknown as Json };
    },
  };
}
