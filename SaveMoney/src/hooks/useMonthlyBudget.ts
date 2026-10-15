import { useEffect, useState, useCallback } from "react";
import { getDb, initSchema } from "../db/client";
import type { Income, Expense, RecurringExpense, Category } from "../types/budget";
import { computeSummary } from "../utils/computeSummary";

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

export function useMonthlyBudget(month: string) {
  const [data, setData] = useState<MonthlyBudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const db = await getDb();
      await initSchema();

      // Helper to calculate previous month in YYYY-MM format
      const getPreviousMonth = (currentMonth: string): string => {
        const [year, month] = currentMonth.split('-').map(Number);
        let prevMonth = month - 1;
        let prevYear = year;
        if (prevMonth < 1) {
          prevMonth = 12;
          prevYear = year - 1;
        }
        return `${prevYear.toString().padStart(4, '0')}-${prevMonth.toString().padStart(2, '0')}`;
      };

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

      // Helper function to identify savings categories
      const isSavingsCategory = (categoryName: string) => {
        if (!categoryName) return false;
        const lowerName = categoryName.toLowerCase();
        return lowerName.includes('épargne') ||
               lowerName.includes('savings');
      };

      // Process current month data
      const savingsExpenses = expenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const regularExpenses = expenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const savingsRecurringExpenses = recurringExpenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const regularRecurringExpenses = recurringExpenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );

      // Prepare data for pure computeSummary function (current month)
      const revenusData = incomes.map(income => ({ amount: income.amount }));
      const depensesData = regularExpenses.map(expense => ({ amount: expense.amount }));
      const chargesFixesData = regularRecurringExpenses.map(expense => ({ amount: expense.amount }));
      const epargneData = [
        ...savingsExpenses.map(expense => ({ amount: expense.amount })),
        ...savingsRecurringExpenses.map(expense => ({ amount: expense.amount }))
      ];

      // Calculate summary using pure function (current month)
      const currentSummary = computeSummary({
        revenus: revenusData,
        depenses: depensesData,
        chargesFixes: chargesFixesData,
        epargne: epargneData
      });

      // Process previous month data
      const previousSavingsExpenses = previousExpenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(previousCategories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const previousRegularExpenses = previousExpenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(previousCategories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const previousSavingsRecurringExpenses = previousRecurringExpenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(previousCategories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const previousRegularRecurringExpenses = previousRecurringExpenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(previousCategories.find(cat => cat.id === expense.category_id)?.name || '')
      );

      // Prepare data for pure computeSummary function (previous month)
      const previousRevenusData = previousIncomes.map(income => ({ amount: income.amount }));
      const previousDepensesData = previousExpenses.map(expense => ({ amount: expense.amount }));
      const previousChargesFixesData = previousRecurringExpenses.map(expense => ({ amount: expense.amount }));
      const previousEpargneData = [
        ...previousSavingsExpenses.map(expense => ({ amount: expense.amount })),
        ...previousSavingsRecurringExpenses.map(expense => ({ amount: expense.amount }))
      ];

      // Calculate summary using pure function (previous month)
      const previousSummary = computeSummary({
        revenus: previousRevenusData,
        depenses: previousDepensesData,
        chargesFixes: previousChargesFixesData,
        epargne: previousEpargneData
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

      setData({
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
      });
    } catch (err) {
      console.error("Failed to load monthly budget", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Vérifie la base de données.";

      setError(`Impossible de charger les données. ${message}`);
      setData({
        incomes: [],
        expenses: [],
        recurringExpenses: [],
        categories: [],
        totalIncome: 0,
        totalExpense: 0,
        totalRecurring: 0,
        totalSavings: 0,
        available: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
