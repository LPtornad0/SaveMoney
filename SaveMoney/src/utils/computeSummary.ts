/**
 * Pure function to compute budget summary from raw financial data
 * This function has no side effects and is easily testable
 */

export interface RawBudgetData {
  revenus: Array<{ amount: number }>;
  depenses: Array<{ amount: number }>;
  chargesFixes: Array<{ amount: number }>;
  epargne: Array<{ amount: number }>;
}

export interface ComputedSummary {
  revenusTotal: number;
  depensesTotal: number;
  chargesFixesTotal: number;
  epargneTotal: number;
  disponible: number;
}

/**
 * Calculate budget summary from raw data
 * @param data - Raw financial data containing arrays of income/expense objects
 * @returns Computed summary with totals
 */
export function computeSummary(data: RawBudgetData): ComputedSummary {
  const revenusTotal = data.revenus.reduce((sum, item) => sum + item.amount, 0);
  const depensesTotal = data.depenses.reduce((sum, item) => sum + item.amount, 0);
  const chargesFixesTotal = data.chargesFixes.reduce((sum, item) => sum + item.amount, 0);
  const epargneTotal = data.epargne.reduce((sum, item) => sum + item.amount, 0);

  // Disponible = Revenus - Dépenses - Charges fixes - Épargne
  const disponible = revenusTotal - depensesTotal - chargesFixesTotal - epargneTotal;

  return {
    revenusTotal,
    depensesTotal,
    chargesFixesTotal,
    epargneTotal,
    disponible
  };
}

export interface BudgetEntry {
  amount: number;
  category_id: number | null;
}

export interface BudgetCategory {
  id: number;
  name: string;
}

export interface MonthData {
  incomes: BudgetEntry[];
  expenses: BudgetEntry[];
  recurringExpenses: BudgetEntry[];
  categories: BudgetCategory[];
}

// Helper function to identify savings categories
export function isSavingsCategory(categoryName: string): boolean {
  if (!categoryName) return false;
  const lowerName = categoryName.toLowerCase();
  return lowerName.includes('épargne') ||
         lowerName.includes('savings');
}

// Same rule as the monthly summary: an entry is savings when its category name says so.
export function isSavingsEntry(entry: BudgetEntry, categories: BudgetCategory[]): boolean {
  if (!entry.category_id) return false;
  const categoryName = categories.find(cat => cat.id === entry.category_id)?.name || '';
  return isSavingsCategory(categoryName);
}

/**
 * Apply the same classification to any month: savings entries are separated
 * from regular expenses and recurring expenses, then computeSummary is applied.
 */
export function summarizeMonth(month: MonthData): ComputedSummary {
  const isSavings = (entry: BudgetEntry): boolean => isSavingsEntry(entry, month.categories);
  const toAmounts = (entries: BudgetEntry[]) => entries.map(entry => ({ amount: entry.amount }));

  return computeSummary({
    revenus: toAmounts(month.incomes),
    depenses: toAmounts(month.expenses.filter(entry => !isSavings(entry))),
    chargesFixes: toAmounts(month.recurringExpenses.filter(entry => !isSavings(entry))),
    epargne: toAmounts([
      ...month.expenses.filter(isSavings),
      ...month.recurringExpenses.filter(isSavings)
    ])
  });
}