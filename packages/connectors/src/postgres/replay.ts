
import type { BeforeImage, QueryExecutor } from "./capture.ts";
import { buildDriftReport, currentRowsForImage, insertSql, updateSql, type DriftReport, type InverseStep } from "./inverse.ts";

export type ReplayExecutor = QueryExecutor & {
  readonly begin?: () => Promise<void>;
  readonly commit?: () => Promise<void>;
  readonly rollback?: () => Promise<void>;
};

export type ApplyInverseReport = {
  readonly applied: readonly string[];
  readonly refused: readonly { readonly stepId: string; readonly reason: "drift" | "internal_error"; readonly report: string }[];
};

const replayQueues = new WeakMap<ReplayExecutor, Promise<unknown>>();

export function applyInverse(exec: ReplayExecutor, steps: readonly InverseStep[], image: BeforeImage): Promise<ApplyInverseReport> {
  const pending = (replayQueues.get(exec) ?? Promise.resolve()).catch(() => {}).then(() => applyTransaction(exec, steps, image));
  replayQueues.set(exec, pending);
  void pending.finally(() => { if (replayQueues.get(exec) === pending) replayQueues.delete(exec); }).catch(() => {});
  return pending;
}

async function applyTransaction(exec: ReplayExecutor, steps: readonly InverseStep[], image: BeforeImage): Promise<ApplyInverseReport> {
  if (steps.length && (!exec.begin || !exec.commit || !exec.rollback)) return { applied: [], refused: [{ stepId: "transaction", reason: "internal_error", report: "Replay requires a dedicated transactional executor with begin, commit and rollback." }] };
  let began = false;
  try {
    await exec.begin?.(); began = true;
    const currentRows = await currentRowsForImage(exec, image);
    const drift = buildReplayDriftReport(image, currentRows);
    if (drift.drifted) {
      await exec.rollback?.();
      return { applied: [], refused: steps.map((step) => ({ stepId: step.id, reason: "drift", report: drift.report })) };
    }

    const applied: string[] = [];
    for (const step of steps) {
      const statement = step.operation === "update" ? updateSql(step) : insertSql(step);
      await exec.query(statement.sql, statement.params);
      applied.push(step.id);
    }
    await exec.commit?.();
    return { applied, refused: [] };
  } catch (error) {
    if (began) await exec.rollback?.().catch(() => {});
    return { applied: [], refused: [{ stepId: "transaction", reason: "internal_error", report: "Transaction failed or its outcome is unknown. Inspect the target before retrying." }] };
  }
}


function buildReplayDriftReport(image: BeforeImage, currentRows: Awaited<ReturnType<typeof currentRowsForImage>>): DriftReport {
  if (image.statement.type === "delete") return currentRows.length ? { drifted: true, report: "Rows already exist at captured primary keys" } : { drifted: false, report: "no drift" };
  if (image.statement.type !== "update") return { drifted: false, report: "no drift" };
  const expectedRows = image.rows.map((row) => ({ ...row, row: { ...row.row, ...image.statement.updatedValues } }));
  return buildDriftReport({ ...image, rows: expectedRows }, currentRows);
}
