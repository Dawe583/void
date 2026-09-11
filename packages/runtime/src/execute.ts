import type {
  Json,
  Observation,
  Outcome,
  Prepared,
  RecoveryAdapter,
  RecoveryOutcome,
} from "../../connectors/src/recovery.ts";
import { canonicalJson } from "../../ledger/src/canonical.ts";
import {
  digest,
  type OperationEvent,
  type OperationJournal,
  type JournalTransaction,
  type Stage,
} from "./journal.ts";
import {
  VaultCapacityError,
  type RecoveryVault,
  type VaultReference,
} from "./vault.ts";
import {
  reserveBudget,
  validateBudget,
  type IrreversibilityBudget,
} from "./budget.ts";
export type ExecutionRequest = {
  workspace: string;
  operationId: string;
  agentId: string;
  runId: string;
  adapterId: string;
  arguments: Json;
};
export type Authorization = {
  digest: string;
  observation: Observation;
  request: ExecutionRequest;
};
export type RuntimeOptions = {
  journal: OperationJournal;
  vault: RecoveryVault;
  adapters: readonly RecoveryAdapter[];
  authorize: (request: Authorization) => Promise<boolean>;
  requireRecoverable?: boolean;
  irreversibilityBudget?: IrreversibilityBudget;
};
export type ExecutionResult = {
  status: Stage;
  operationId: string;
  result?: Json;
  reason?: "recovery-capacity";
};
export type RecoveryPlan = {
  workspace: string;
  operationId: string;
  digest: string;
  scope: string;
  resources: string[];
  reversibility: string;
};
const adapterKey = (workspace: string, operationId: string) =>
  digest({ workspace, operationId });
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function latest(tx: JournalTransaction, id: string) {
  return [...tx.events].reverse().find((e) => e.operationId === id);
}
function artifact(
  tx: JournalTransaction,
  id: string,
  stage: Stage,
): VaultReference {
  const event = [...tx.events]
    .reverse()
    .find((e) => e.operationId === id && e.stage === stage);
  if (!event) throw new Error("Required operation evidence is missing.");
  return event.data as unknown as VaultReference;
}
export function recoveryRuntime(options: RuntimeOptions) {
  if (options.irreversibilityBudget)
    validateBudget(options.irreversibilityBudget);
  const adapters = new Map<string, RecoveryAdapter>();
  for (const adapter of options.adapters) {
    if (adapters.has(adapter.id) || !adapter.id || !adapter.version)
      throw new Error("Invalid or duplicate recovery adapter.");
    adapters.set(adapter.id, adapter);
  }
  const adapterFor = (id: string, version?: string) => {
    const adapter = adapters.get(id);
    if (!adapter || (version && version !== adapter.version))
      throw new Error("Recovery adapter version is unavailable.");
    return adapter;
  };
  const record = async (
    tx: JournalTransaction,
    identity: OperationEvent,
    stage: Stage,
    data: Json = null,
  ) => {
    await tx.append({ ...identity, stage, data, at: new Date().toISOString() });
  };
  const loadPrepared = async (tx: JournalTransaction, event: OperationEvent) =>
    (await options.vault.get(
      event.workspace,
      artifact(tx, event.operationId, "prepared"),
    )) as unknown as {
      request: ExecutionRequest;
      observation: Observation;
      prepared: Prepared;
    };
  const resultFor = async (
    tx: JournalTransaction,
    event: OperationEvent,
  ): Promise<ExecutionResult> => ({
    status: event.stage,
    operationId: event.operationId,
    ...(event.data &&
    typeof event.data === "object" &&
    !Array.isArray(event.data) &&
    event.data.reason === "recovery-capacity"
      ? { reason: "recovery-capacity" as const }
      : {}),
    ...(event.stage === "succeeded"
      ? {
          result: (
            (await options.vault.get(
              event.workspace,
              artifact(tx, event.operationId, "succeeded"),
            )) as unknown as Outcome
          ).result,
        }
      : {}),
  });
  return {
    async status(
      workspace: string,
      operationId: string,
    ): Promise<Stage | undefined> {
      return options.journal.transaction(
        workspace,
        async (tx) => latest(tx, operationId)?.stage,
      );
    },
    async execute(input: ExecutionRequest): Promise<ExecutionResult> {
      // Canonical validation happens before the JSON clone, which would silently erase undefined.
      const requestDigest = digest(input),
        request = clean(input),
        adapter = adapterFor(request.adapterId);
      for (const value of [request.operationId, request.agentId, request.runId])
        if (!/^[\w-]{1,120}$/.test(value))
          throw new Error("Invalid operation identity.");
      return options.journal.transaction(request.workspace, async (tx) => {
        const prior = latest(tx, request.operationId);
        if (prior) {
          if (
            prior.requestDigest !== requestDigest ||
            prior.adapterVersion !== adapter.version
          )
            throw new Error(
              "Idempotency key belongs to another request or adapter version.",
            );
          // A crashed process never silently resumes a possibly dispatched operation.
          if (prior.stage === "dispatched") {
            await record(tx, prior, "unknown");
            return { status: "unknown", operationId: prior.operationId };
          }
          return resultFor(tx, prior);
        }
        const identity: OperationEvent = {
          schema: "void.operation.v1",
          workspace: request.workspace,
          operationId: request.operationId,
          requestDigest,
          adapterId: adapter.id,
          adapterVersion: adapter.version,
          agentId: request.agentId,
          runId: request.runId,
          at: new Date().toISOString(),
          stage: "received",
          data: null,
        };
        await tx.append(identity);
        let dispatched = false;
        try {
          const observation = JSON.parse(
            canonicalJson(await adapter.preflight(clean(request.arguments))),
          ) as Observation;
          digest(observation);
          if (
            options.requireRecoverable !== false &&
            (observation.readiness !== "verified" ||
              !["r0", "r1"].includes(observation.reversibility))
          ) {
            await record(tx, identity, "denied");
            return { status: "denied", operationId: request.operationId };
          }
          const approvalDigest = digest({
            requestDigest,
            adapterVersion: adapter.version,
            observation,
          });
          if (
            !(await options.authorize({
              digest: approvalDigest,
              observation: clean(observation),
              request: clean(request),
            }))
          ) {
            await record(tx, identity, "denied");
            return { status: "denied", operationId: request.operationId };
          }
          const needsBudget =
            observation.readiness !== "verified" ||
            observation.reversibility === "r3" ||
            observation.reversibility === "unknown";
          const budget =
            needsBudget && options.irreversibilityBudget
              ? reserveBudget(
                  tx.events,
                  options.irreversibilityBudget,
                  request.agentId,
                )
              : null;
          if (needsBudget && !budget) {
            await record(tx, identity, "denied", {
              reason: "irreversibility-budget",
            });
            return { status: "denied", operationId: request.operationId };
          }
          await record(tx, identity, "authorized", {
            approvalDigest,
            ...(budget ? { budget } : {}),
          });
          await options.vault.reserve?.(request.workspace, request.operationId);
          const prepared = await adapter.prepare(
            clean(request.arguments),
            clean(observation),
            adapterKey(request.workspace, request.operationId),
          );
          digest(prepared);
          const capture = await options.vault.put(
            request.workspace,
            clean({ request, observation, prepared }) as unknown as Json,
            { operationId: request.operationId, slot: "capture" },
          );
          await record(tx, identity, "prepared", capture as unknown as Json);
          await record(tx, identity, "dispatched");
          dispatched = true;
          const outcome = await adapter.execute(
            clean(request.arguments),
            clean(prepared),
            adapterKey(request.workspace, request.operationId),
          );
          const result = await options.vault.put(
            request.workspace,
            outcome as unknown as Json,
            { operationId: request.operationId, slot: "outcome" },
          );
          await record(tx, identity, "succeeded", result as unknown as Json);
          return {
            status: "succeeded",
            operationId: request.operationId,
            result: outcome.result,
          };
        } catch (error) {
          const reason =
            error instanceof VaultCapacityError
              ? ("recovery-capacity" as const)
              : undefined;
          await record(
            tx,
            identity,
            dispatched ? "unknown" : "failed",
            reason ? { reason } : null,
          );
          return {
            status: dispatched ? "unknown" : "failed",
            operationId: request.operationId,
            ...(reason ? { reason } : {}),
          };
        } finally {
          if (!dispatched)
            await options.vault
              .release?.(request.workspace, request.operationId)
              .catch(() => {});
          await adapter
            .release(adapterKey(request.workspace, request.operationId))
            .catch(() => {});
        }
      });
    },
    async reconcile(
      workspace: string,
      operationId: string,
    ): Promise<ExecutionResult> {
      return options.journal.transaction(workspace, async (tx) => {
        let event = latest(tx, operationId);
        if (!event) throw new Error("Operation not found.");
        if (event.stage !== "dispatched" && event.stage !== "unknown")
          return resultFor(tx, event);
        const adapter = adapterFor(event.adapterId, event.adapterVersion),
          bundle = await loadPrepared(tx, event);
        await options.vault.reserve?.(workspace, operationId, ["outcome"]);
        const result = await adapter.reconcile(
          adapterKey(workspace, operationId),
          bundle.prepared,
        );
        if (result.status === "succeeded") {
          const reference = await options.vault.put(
            workspace,
            result.outcome as unknown as Json,
            { operationId, slot: "outcome" },
          );
          await record(tx, event, "succeeded", reference as unknown as Json);
        } else {
          await record(tx, event, result.status);
          if (result.status === "failed")
            await options.vault.release?.(workspace, operationId);
        }
        return resultFor(tx, latest(tx, operationId)!);
      });
    },
    async reconcileRecovery(
      workspace: string,
      operationId: string,
    ): Promise<RecoveryOutcome | { status: "unknown" }> {
      return options.journal.transaction(workspace, async (tx) => {
        const event = latest(tx, operationId);
        if (!event) throw new Error("Operation not found.");
        const data = event.data as unknown as {
          planDigest: string;
          receipt: VaultReference;
        };
        if (["restored", "compensated", "conflict"].includes(event.stage))
          return (await options.vault.get(
            workspace,
            data.receipt,
          )) as unknown as RecoveryOutcome;
        if (
          event.stage !== "recovery-dispatched" &&
          event.stage !== "recovery-unknown"
        )
          throw new Error("No uncertain recovery exists.");
        const adapter = adapterFor(event.adapterId, event.adapterVersion);
        if (!adapter.reconcileRecovery) return { status: "unknown" };
        await options.vault.reserve?.(workspace, operationId, ["recovery"]);
        const bundle = await loadPrepared(tx, event);
        const outcome = (await options.vault.get(
          workspace,
          artifact(tx, operationId, "succeeded"),
        )) as unknown as Outcome;
        const result = await adapter.reconcileRecovery(
          clean(bundle.prepared),
          clean(outcome),
          `recovery-${adapterKey(workspace, operationId)}`,
        );
        if (result.status === "unknown") return result;
        const receipt = await options.vault.put(
          workspace,
          result as unknown as Json,
          { operationId, slot: "recovery" },
        );
        await record(tx, event, result.status, {
          planDigest: data.planDigest,
          receipt: receipt as unknown as Json,
          reverses: operationId,
        });
        return result;
      });
    },
    async planRecovery(
      workspace: string,
      operationId: string,
    ): Promise<RecoveryPlan> {
      return options.journal.transaction(workspace, async (tx) => {
        const event = latest(tx, operationId);
        if (!event || event.stage !== "succeeded")
          throw new Error(
            "Only a confirmed successful operation can be planned for recovery.",
          );
        adapterFor(event.adapterId, event.adapterVersion);
        const bundle = await loadPrepared(tx, event);
        if (
          bundle.observation.readiness !== "verified" ||
          !["r0", "r1", "r2"].includes(bundle.observation.reversibility)
        )
          throw new Error("Operation has no verified recovery capability.");
        // Missing/invalid result or capture fails the preview before approval.
        await options.vault.get(
          workspace,
          artifact(tx, operationId, "succeeded"),
        );
        await options.vault.reserve?.(workspace, operationId, ["recovery"]);
        return {
          workspace,
          operationId,
          digest: digest({
            event,
            capture: artifact(tx, operationId, "prepared"),
          }),
          scope: bundle.observation.scope,
          resources: bundle.observation.resources,
          reversibility: bundle.observation.reversibility,
        };
      });
    },
    async recover(
      inputPlan: RecoveryPlan,
      authorize: (plan: RecoveryPlan) => Promise<boolean>,
    ): Promise<RecoveryOutcome | { status: "unknown" }> {
      const plan = JSON.parse(canonicalJson(inputPlan)) as RecoveryPlan;
      return options.journal.transaction(plan.workspace, async (tx) => {
        const event = latest(tx, plan.operationId);
        if (!event) throw new Error("Operation not found.");
        if (
          event.stage === "restored" ||
          event.stage === "compensated" ||
          event.stage === "conflict"
        ) {
          const reference = event.data as unknown as {
            planDigest: string;
            receipt: VaultReference;
          };
          if (reference.planDigest !== plan.digest)
            throw new Error("Recovery plan changed.");
          return (await options.vault.get(
            plan.workspace,
            reference.receipt,
          )) as unknown as RecoveryOutcome;
        }
        if (
          event.stage === "recovery-dispatched" ||
          event.stage === "recovery-unknown"
        )
          return { status: "unknown" };
        if (event.stage !== "succeeded")
          throw new Error("Operation is not ready for recovery.");
        const expected = digest({
          event,
          capture: artifact(tx, plan.operationId, "prepared"),
        });
        const bundle = await loadPrepared(tx, event);
        if (
          bundle.observation.readiness !== "verified" ||
          !["r0", "r1", "r2"].includes(bundle.observation.reversibility)
        )
          throw new Error("Operation has no verified recovery capability.");
        const actual = {
          workspace: plan.workspace,
          operationId: plan.operationId,
          digest: expected,
          scope: bundle.observation.scope,
          resources: bundle.observation.resources,
          reversibility: bundle.observation.reversibility,
        };
        if (digest(actual) !== digest(plan))
          throw new Error("Recovery plan changed.");
        if (!(await authorize(clean(actual))))
          throw new Error("Recovery was not authorized.");
        const adapter = adapterFor(event.adapterId, event.adapterVersion);
        const outcome = (await options.vault.get(
          plan.workspace,
          artifact(tx, plan.operationId, "succeeded"),
        )) as unknown as Outcome;
        await options.vault.reserve?.(plan.workspace, plan.operationId, [
          "recovery",
        ]);
        await record(tx, event, "recovery-dispatched", {
          planDigest: expected,
          reverses: event.operationId,
        });
        try {
          const result = await adapter.recover(
            clean(bundle.prepared),
            clean(outcome),
            `recovery-${adapterKey(plan.workspace, plan.operationId)}`,
          );
          const receipt = await options.vault.put(
            plan.workspace,
            result as unknown as Json,
            { operationId: plan.operationId, slot: "recovery" },
          );
          await record(tx, event, result.status, {
            planDigest: expected,
            receipt: receipt as unknown as Json,
            reverses: event.operationId,
          });
          return result;
        } catch {
          await record(tx, event, "recovery-unknown", {
            planDigest: expected,
            reverses: event.operationId,
          });
          return { status: "unknown" };
        }
      });
    },
  };
}
