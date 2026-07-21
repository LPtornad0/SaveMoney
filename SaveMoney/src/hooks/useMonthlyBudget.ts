import { useEffect, useState, useCallback } from "react";
import { getDb } from "../db/client";
import type { Income, Expense, RecurringExpense, Category } from "../types/budget";

export interface MonthlyBudgetData {
  incomes: Income[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  categories: Category[];
  totalIncome: number;
  totalExpense: number;
  totalRecurring: number;
  available: number;
}

export function useMonthlyBudget(month: string) {
  const [data, setData] = useState<MonthlyBudgetData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const db = await getDb();

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

    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalRecurring = recurringExpenses.reduce((sum, r) => sum + r.amount, 0);
    const available = totalIncome - totalExpense - totalRecurring;

    setData({
      incomes,
      expenses,
      recurringExpenses,
      categories,
      totalIncome,
      totalExpense,
      totalRecurring,
      available,
    });
    setLoading(false);
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, refresh: load };
}
