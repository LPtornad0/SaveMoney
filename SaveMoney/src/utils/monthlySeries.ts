// Monthly series for the evolution card: revenues and one-off expenses over the last months.
// The classification is the one of computeSummary.ts (isSavingsEntry). Charges fixes are not part of the
// series: recurring expenses have no history, so a past month cannot be rebuilt from them.
import { isSavingsEntry, type BudgetCategory, type BudgetEntry } from "./computeSummary";
import { addMonths } from "./monthNavigation";
import type { MonthDb } from "./monthBudget";

export const SERIES_LENGTH = 6;

export interface SeriesSource extends BudgetEntry {
  id: number;
  month: string;
}

// Rows read for the period, in one grouped query per table
export interface SeriesRows {
  months: string[];
  incomes: SeriesSource[];
  expenses: SeriesSource[];
  categories: BudgetCategory[];
}

// Operations hidden while their deletion is pending. The series leave them out, as the lists do.
export interface ExcludedOperation {
  id: number;
  type: "income" | "expense";
}

// What the month contains, from the most to the least informative:
// "recorded": at least one income or one-off expense is counted;
// "savings-only": only savings expenses are recorded, excluded from the series;
// "pending-only": operations are recorded, but all of them are pending deletion, so excluded;
// "none": nothing is recorded for the month.
export type MonthStatus = "none" | "savings-only" | "pending-only" | "recorded";

export interface MonthlySeriesRow {
  month: string;
  revenus: number;
  depensesPonctuelles: number;
  status: MonthStatus;
}

// The months of the period, oldest first, ending with endMonth (which may be in the future: no extrapolation)
export function periodMonths(endMonth: string, length: number = SERIES_LENGTH): string[] {
  const months: string[] = [];
  for (let offset = length - 1; offset >= 0; offset -= 1) {
    const month = addMonths(endMonth, -offset);
    if (month === null) throw new Error(`Mois invalide : ${endMonth}`);
    months.push(month);
  }
  return months;
}

function sum(entries: SeriesSource[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

export function buildMonthlySeries(
  source: SeriesRows & { excluded?: ExcludedOperation[] }
): MonthlySeriesRow[] {
  const excluded = source.excluded ?? [];
  const isExcluded = (type: ExcludedOperation["type"], id: number) =>
    excluded.some((item) => item.type === type && item.id === id);

  return source.months.map((month) => {
    const recordedIncomes = source.incomes.filter((entry) => entry.month === month);
    const recordedExpenses = source.expenses.filter((entry) => entry.month === month);
    const incomes = recordedIncomes.filter((entry) => !isExcluded("income", entry.id));
    const expenses = recordedExpenses.filter((entry) => !isExcluded("expense", entry.id));
    const oneOff = expenses.filter((entry) => !isSavingsEntry(entry, source.categories));
    const savings = expenses.filter((entry) => isSavingsEntry(entry, source.categories));

    let status: MonthStatus;
    if (incomes.length > 0 || oneOff.length > 0) status = "recorded";
    else if (savings.length > 0) status = "savings-only";
    else if (recordedIncomes.length + recordedExpenses.length > 0) status = "pending-only";
    else status = "none";

    return {
      month,
      revenus: sum(incomes),
      depensesPonctuelles: sum(oneOff),
      status,
    };
  });
}

// Reads the whole period with one query per table. The month bounds are inclusive, and YYYY-MM sorts as text.
export async function fetchSeriesRows(db: MonthDb, months: string[]): Promise<SeriesRows> {
  const start = months[0];
  const end = months[months.length - 1];
  const [incomes, expenses, categories] = await Promise.all([
    db.select<SeriesSource[]>(
      "SELECT id, month, amount, category_id FROM incomes WHERE month >= ? AND month <= ?",
      [start, end]
    ),
    db.select<SeriesSource[]>(
      "SELECT id, month, amount, category_id FROM expenses WHERE month >= ? AND month <= ?",
      [start, end]
    ),
    db.select<BudgetCategory[]>("SELECT * FROM categories ORDER BY name", []),
  ]);
  return { months, incomes, expenses, categories };
}
