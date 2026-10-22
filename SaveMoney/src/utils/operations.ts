// Pure ordering rules for the operations panel. No dates are invented for recurring expenses.

export interface OperationSource {
  id: number;
  label: string;
  amount: number;
  date: string; // YYYY-MM-DD, as stored
  category_id: number | null;
}

export type OperationKind = "income" | "expense";

export interface Operation extends OperationSource {
  kind: OperationKind;
  key: string;
}

const KIND_RANK: Record<OperationKind, number> = { income: 0, expense: 1 };

// Incomes and expenses of the displayed month, most recent date first.
// Ties are broken deterministically: income before expense, then higher id first.
export function buildOperations(incomes: OperationSource[], expenses: OperationSource[]): Operation[] {
  const all: Operation[] = [
    ...incomes.map((entry) => ({ ...entry, kind: "income" as const, key: `income-${entry.id}` })),
    ...expenses.map((entry) => ({ ...entry, kind: "expense" as const, key: `expense-${entry.id}` })),
  ];
  return all.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.id - a.id
  );
}

// Recurring expenses by day of the month, ascending. Entries without a day come last.
export function sortRecurring<T extends { id: number; day_of_month: number | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const dayA = a.day_of_month ?? Number.POSITIVE_INFINITY;
    const dayB = b.day_of_month ?? Number.POSITIVE_INFINITY;
    if (dayA !== dayB) return dayA < dayB ? -1 : 1;
    return a.id - b.id;
  });
}

// Shows the date without going through Date, so the time zone cannot shift it.
export function formatShortDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}
