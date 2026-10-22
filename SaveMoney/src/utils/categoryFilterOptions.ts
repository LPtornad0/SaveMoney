// Options of the keyboard category selector. It only lists and encodes filters: the filtering itself
// stays in chartRows.ts, and the Dashboard applies the chosen filter through the same path as a chart click.
import { isSameFilter, type CategoryFilter, type ChartCategory, type ChartRow } from "./chartRows";

export interface FilterOption {
  value: string;
  label: string;
}

export const ALL_CATEGORIES_VALUE = "";
const UNCATEGORIZED_VALUE = "uncategorized";
const CATEGORY_PREFIX = "category:";

// Encodes a filter as a select value: "" for no filter, "category:<id>", or "uncategorized"
export function filterToValue(filter: CategoryFilter | null): string {
  if (filter === null) return ALL_CATEGORIES_VALUE;
  if (filter.kind === "uncategorized") return UNCATEGORIZED_VALUE;
  return `${CATEGORY_PREFIX}${filter.categoryId}`;
}

// Decodes a select value. Returns null for "no filter", undefined for a value that is not one of ours.
export function valueToFilter(value: string): CategoryFilter | null | undefined {
  if (value === ALL_CATEGORIES_VALUE) return null;
  if (value === UNCATEGORIZED_VALUE) return { kind: "uncategorized" };
  if (value.startsWith(CATEGORY_PREFIX)) {
    const categoryId = Number(value.slice(CATEGORY_PREFIX.length));
    if (Number.isInteger(categoryId) && categoryId > 0) return { kind: "category", categoryId };
  }
  return undefined;
}

// Options: every category shown in the chart, plus the active filter when it is no longer in the chart
// (for example after its last entry was moved elsewhere), so the active filter can always be seen and removed.
export function buildFilterOptions(
  rows: ChartRow[],
  activeFilter: CategoryFilter | null,
  activeLabel: string
): FilterOption[] {
  const options: FilterOption[] = [{ value: ALL_CATEGORIES_VALUE, label: "Toutes les catégories" }];
  for (const row of rows) {
    options.push({ value: filterToValue(row.filter), label: row.label });
  }
  if (activeFilter !== null && !rows.some((row) => isSameFilter(activeFilter, row.filter))) {
    options.push({ value: filterToValue(activeFilter), label: `${activeLabel} (absente du graphique)` });
  }
  return options;
}

// Label of a filter, the same for the chip and the selector
export function filterLabel(filter: CategoryFilter, categories: ChartCategory[]): string {
  if (filter.kind === "uncategorized") return "Sans catégorie";
  return categories.find((cat) => cat.id === filter.categoryId)?.name ?? "Catégorie";
}
