// Rules for the current amount of a savings goal. Pure: no React, no database.
// Replacing the amount is not a deposit: the typed value becomes the new current amount.

export const GOAL_AMOUNT_INVALID = "Saisissez un montant positif ou nul";
export const GOAL_SAVE_ERROR = "L'enregistrement a échoué. Le montant saisi est conservé.";

// Zero is accepted; empty, negative, non-numeric and non-finite values are refused.
export function parseCurrentAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  // Turns -0 into 0
  return amount === 0 ? 0 : amount;
}

// The draft is compared by value, so "100" and "100.00" are the same amount.
// An empty or unreadable draft counts as a change: it cannot be saved as it is.
export function isGoalDraftChanged(baseline: number, draft: string): boolean {
  if (draft.trim() === "") return true;
  return !(Number(draft) === baseline);
}

export interface GoalProgress {
  // Gauge and percentage, capped at 100 %
  percent: number;
  // The real amount, never capped: above the target it keeps its exact value
  amount: number;
}

// A target of zero or less has no meaningful progress: the gauge stays empty.
export function goalProgress(current: number, target: number): GoalProgress {
  const ratio = target > 0 ? (current / target) * 100 : 0;
  return { percent: Math.min(Math.max(ratio, 0), 100), amount: current };
}
