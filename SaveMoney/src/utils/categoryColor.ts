// Colored dots for categories. The color comes from the category id only, so it is stable across
// reloads. Nothing is written to the database, and categories.color is not used.
import { isUncategorized, type ChartCategory } from "./chartRows";

export const CATEGORY_PALETTE = [
  "#38BDF8",
  "#A3E635",
  "#F472B6",
  "#C084FC",
  "#FB7185",
  "#2DD4BF",
  "#FACC15",
  "#818CF8",
] as const;

// Null for an uncategorized entry: the dot is then drawn neutral, without a color.
export function categoryDotColor(categoryId: number | null, categories: ChartCategory[]): string | null {
  if (isUncategorized(categoryId, categories)) return null;
  const size = CATEGORY_PALETTE.length;
  const index = (((categoryId as number) % size) + size) % size;
  return CATEGORY_PALETTE[index];
}
