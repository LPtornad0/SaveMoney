import type { Income, Expense, RecurringExpense, Category } from "../types/budget";
import { summarizeMonth } from "./computeSummary";

export interface MonthlyBudgetData {
  incomes: Income[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  categories: Category[];
  totalIncome: number;
  totalExpense: number;
  totalRecurring: number;
  totalSavings: number;
  available: number;
  // Previous month data for variation calculations
  previousTotalIncome?: number;
  previousTotalExpense?: number;
  previousTotalRecurring?: number;
  previousTotalSavings?: number;
  previousAvailable?: number;
  // Variation (current - previous)
  variationIncome?: number;
  variationExpense?: number;
  variationRecurring?: number;
  variationSavings?: number;
  variationAvailable?: number;
}

// Only the query method is needed; the Tauri database and a test double both satisfy it.
export interface MonthDb {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

// Helper to calculate previous month in YYYY-MM format
export function getPreviousMonth(currentMonth: string): string {
  const [year, month] = currentMonth.split('-').map(Number);
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  return `${prevYear.toString().padStart(4, '0')}-${prevMonth.toString().padStart(2, '0')}`;
}

export async function fetchMonthBudget(db: MonthDb, month: string): Promise<MonthlyBudgetData> {
  const currentMonthData = await Promise.all([
    db.select<Income[]>("SELECT * FROM incomes WHERE month = ? ORDER BY date DESC", [month]),
    db.select<Expense[]>("SELECT * FROM expenses WHERE month = ? ORDER BY date DESC", [month]),
    db.select<RecurringExpense[]>("SELECT * FROM recurring_expenses WHERE active = 1", []),
    db.select<Category[]>("SELECT * FROM categories ORDER BY name", [])
  ]);

  const previousMonthData = await Promise.all([
    db.select<Income[]>("SELECT * FROM incomes WHERE month = ? ORDER BY date DESC", [getPreviousMonth(month)]),
    db.select<Expense[]>("SELECT * FROM expenses WHERE month = ? ORDER BY date DESC", [getPreviousMonth(month)]),
    db.select<RecurringExpense[]>("SELECT * FROM recurring_expenses WHERE active = 1", []),
    db.select<Category[]>("SELECT * FROM categories ORDER BY name", [])
  ]);

  const [incomes, expenses, recurringExpenses, categories] = currentMonthData;
  const [previousIncomes, previousExpenses, previousRecurringExpenses, previousCategories] = previousMonthData;

  // Both months go through the same classification (savings separated from expenses)
  const currentSummary = summarizeMonth({ incomes, expenses, recurringExpenses, categories });
  const previousSummary = summarizeMonth({
    incomes: previousIncomes,
    expenses: previousExpenses,
    recurringExpenses: previousRecurringExpenses,
    categories: previousCategories
  });

  // Extract calculated values for current month
  const totalSavings = currentSummary.epargneTotal;
  const totalExpense = currentSummary.depensesTotal;
  const totalRecurring = currentSummary.chargesFixesTotal;
  const available = currentSummary.disponible;
  const totalIncome = currentSummary.revenusTotal;

  // Calculate variations (current - previous)
  const variationIncome = totalIncome - previousSummary.revenusTotal;
  const variationExpense = totalExpense - previousSummary.depensesTotal;
  const variationRecurring = totalRecurring - previousSummary.chargesFixesTotal;
  const variationSavings = totalSavings - previousSummary.epargneTotal;
  const variationAvailable = available - previousSummary.disponible;

  return {
    incomes,
    expenses,
    recurringExpenses,
    categories,
    totalIncome,
    totalExpense,
    totalRecurring,
    totalSavings,
    available,
    // Store previous month data for variation calculations (optional - we could just store variations)
    previousTotalIncome: previousSummary.revenusTotal,
    previousTotalExpense: previousSummary.depensesTotal,
    previousTotalRecurring: previousSummary.chargesFixesTotal,
    previousTotalSavings: previousSummary.epargneTotal,
    previousAvailable: previousSummary.disponible,
    variationIncome,
    variationExpense,
    variationRecurring,
    variationSavings,
    variationAvailable
  };
}

// Shown after a failed load, as before: the data is emptied, the error is displayed by the hook.
export function emptyMonthBudget(): MonthlyBudgetData {
  return {
    incomes: [],
    expenses: [],
    recurringExpenses: [],
    categories: [],
    totalIncome: 0,
    totalExpense: 0,
    totalRecurring: 0,
    totalSavings: 0,
    available: 0,
  };
}
