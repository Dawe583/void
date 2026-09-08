
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

export async function applyInverse(exec: ReplayExecutor, steps: readonly InverseStep[], image: BeforeImage): Promise<ApplyInverseReport> {
  await exec.begin?.();
  try {
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
    await exec.rollback?.();
    return { applied: [], refused: [{ stepId: "transaction", reason: "internal_error", report: error instanceof Error ? error.message : String(error) }] };
  }
}


function buildReplayDriftReport(image: BeforeImage, currentRows: Awaited<ReturnType<typeof currentRowsForImage>>): DriftReport {
  if (image.statement.type !== "update") return { drifted: false, report: "no drift" };
  const expectedRows = image.rows.map((row) => ({ ...row, row: { ...row.row, ...image.statement.updatedValues } }));
  return buildDriftReport({ ...image, rows: expectedRows }, currentRows);
}
