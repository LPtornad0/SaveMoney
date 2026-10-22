import { isSavingsCategory } from "./computeSummary";

export interface ChartCategory {
  id: number;
  name: string;
  type: "income" | "expense";
}

export interface ChartEntry {
  amount: number;
  category_id: number | null;
}

export interface ChartRowSource {
  categories: ChartCategory[];
  expenses: ChartEntry[];
  recurringExpenses: ChartEntry[];
}

// Explicit filter states: no filter (null), a known category, or entries without a valid category.
export type CategoryFilter =
  | { kind: "category"; categoryId: number }
  | { kind: "uncategorized" };

export interface ChartRow {
  key: string;
  filter: CategoryFilter;
  label: string;
  total: number;
}

export const UNCATEGORIZED_LABEL = "Sans catégorie";

// An entry is uncategorized when it has no category or refers to a category that does not exist.
// A category really named "Sans catégorie" keeps its own id and is not uncategorized.
export function isUncategorized(categoryId: number | null, categories: ChartCategory[]): boolean {
  return categoryId === null || !categories.some((cat) => cat.id === categoryId);
}

export function matchesCategoryFilter(
  categoryId: number | null,
  filter: CategoryFilter,
  categories: ChartCategory[]
): boolean {
  if (filter.kind === "uncategorized") return isUncategorized(categoryId, categories);
  return categoryId === filter.categoryId;
}

// Applies the filter to incomes or expenses; no filter keeps every entry.
export function filterByCategory<T extends ChartEntry>(
  entries: T[],
  filter: CategoryFilter | null,
  categories: ChartCategory[]
): T[] {
  if (filter === null) return entries;
  return entries.filter((entry) => matchesCategoryFilter(entry.category_id, filter, categories));
}

export function isSameFilter(a: CategoryFilter | null, b: CategoryFilter): boolean {
  if (a === null) return false;
  if (a.kind === "uncategorized" || b.kind === "uncategorized") return a.kind === b.kind;
  return a.categoryId === b.categoryId;
}

// Expense categories without savings, plus one "Sans catégorie" row, largest total first.
// Rows with a total of zero or less are hidden. Savings are excluded everywhere.
export function buildChartRows(data: ChartRowSource): ChartRow[] {
  const sum = (entries: ChartEntry[]) => entries.reduce((total, entry) => total + entry.amount, 0);

  const categoryRows: ChartRow[] = data.categories
    .filter((cat) => cat.type === "expense" && !isSavingsCategory(cat.name))
    .map((cat) => {
      const expenses = data.expenses.filter((e) => e.category_id === cat.id);
      const recurring = data.recurringExpenses.filter((r) => r.category_id === cat.id);
      return {
        key: `category-${cat.id}`,
        filter: { kind: "category" as const, categoryId: cat.id },
        label: cat.name,
        total: sum(expenses) + sum(recurring),
      };
    });

  const uncategorizedRow: ChartRow = {
    key: "uncategorized",
    filter: { kind: "uncategorized" },
    label: UNCATEGORIZED_LABEL,
    total:
      sum(data.expenses.filter((e) => isUncategorized(e.category_id, data.categories))) +
      sum(data.recurringExpenses.filter((r) => isUncategorized(r.category_id, data.categories))),
  };

  return [...categoryRows, uncategorizedRow]
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);
}
