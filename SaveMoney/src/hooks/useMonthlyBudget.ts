import { useEffect, useState, useCallback } from "react";
import { getDb, initSchema } from "../db/client";
import type { Income, Expense, RecurringExpense, Category } from "../types/budget";

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

      const incomes = await db.select<Income[]>(
        "SELECT * FROM incomes WHERE month = ? ORDER BY date DESC",
        [month]
      );

      const expenses = await db.select<Expense[]>(
        "SELECT * FROM expenses WHERE month = ? ORDER BY date DESC",
        [month]
      );

      const recurringExpenses = await db.select<RecurringExpense[]>(
        "SELECT * FROM recurring_expenses WHERE active = 1",
        []
      );

      const categories = await db.select<Category[]>(
        "SELECT * FROM categories ORDER BY name",
        []
      );

      // Helper function to identify savings categories
      const isSavingsCategory = (categoryName: string) => {
        if (!categoryName) return false;
        const lowerName = categoryName.toLowerCase();
        return lowerName.includes(' épargne') ||
               lowerName.includes(' savings') ||
               lowerName.includes(' épargne');
      };

      const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);

      // Separate expenses into savings and regular
      const savingsExpenses = expenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const regularExpenses = expenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );

      // Separate recurring expenses into savings and regular
      const savingsRecurringExpenses = recurringExpenses.filter(expense =>
        expense.category_id &&
        isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );
      const regularRecurringExpenses = recurringExpenses.filter(expense =>
        !expense.category_id ||
        !isSavingsCategory(categories.find(cat => cat.id === expense.category_id)?.name || '')
      );

      const totalSavings = savingsExpenses.reduce((sum, expense) => sum + expense.amount, 0) +
                          savingsRecurringExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const totalExpense = regularExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const totalRecurring = regularRecurringExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const available = totalIncome - totalExpense - totalRecurring;

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
