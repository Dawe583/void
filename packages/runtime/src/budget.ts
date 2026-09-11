import type { OperationEvent } from "./journal.ts";
export type IrreversibilityBudget = {
  dailyLimit: number;
  perAgentDailyLimit?: number;
};
export type BudgetReservation = { day: string; units: 1; agentId: string };
export function validateBudget(budget: IrreversibilityBudget): void {
  for (const limit of [
    budget.dailyLimit,
    ...(budget.perAgentDailyLimit === undefined
      ? []
      : [budget.perAgentDailyLimit]),
  ])
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error("Budget limits must be nonnegative integers.");
}
/** Called inside the same workspace journal transaction as authorization and dispatch.
 * Unknown outcomes and unfinished reservations remain spent. No retry resets them. */
export function reserveBudget(
  events: readonly OperationEvent[],
  budget: IrreversibilityBudget,
  agentId: string,
  now = new Date(),
): BudgetReservation | null {
  validateBudget(budget);
  const day = now.toISOString().slice(0, 10),
    last = new Map(events.map((event) => [event.operationId, event]));
  let total = 0,
    agent = 0;
  for (const event of events) {
    if (
      event.stage !== "authorized" ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    )
      continue;
    const reservation = event.data.budget as BudgetReservation | undefined;
    if (!reservation || reservation.day !== day) continue;
    // Only a confirmed failure releases the reservation. Unknown still consumes it.
    if (last.get(event.operationId)?.stage === "failed") continue;
    total += reservation.units;
    if (reservation.agentId === agentId) agent += reservation.units;
  }
  if (
    total >= budget.dailyLimit ||
    agent >= (budget.perAgentDailyLimit ?? budget.dailyLimit)
  )
    return null;
  return { day, units: 1, agentId };
}
