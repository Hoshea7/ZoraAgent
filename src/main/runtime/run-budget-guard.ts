import type { RunBudget } from "../agent-profiles/types";

export interface RunBudgetGuard {
  /** 一个 assistant turn 结束时记账；返回 true 表示应停止。 */
  shouldStopAfterTurn(): boolean;
  reset(): void;
}

export function createRunBudgetGuard(budget: RunBudget): RunBudgetGuard {
  const limit = Number.isFinite(budget.maxTurns) && budget.maxTurns > 0
    ? budget.maxTurns
    : 1;
  let turnCount = 0;

  return {
    shouldStopAfterTurn: () => {
      turnCount += 1;
      return turnCount >= limit;
    },
    reset: () => {
      turnCount = 0;
    },
  };
}
