import { useEffect, useState, useCallback } from "react";
import { getDb, initSchema } from "../db/client";
import type { Debt, Category } from "../types/budget";

export interface DebtsData {
  debts: Debt[];
  categories: Category[];
}

export function useDebts() {
  const [data, setData] = useState<DebtsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const db = await getDb();
      await initSchema();

      const [debtsResult, categoriesResult] = await Promise.all([
        db.select<Debt[]>(
          "SELECT d.*, c.name as category_name FROM debts d LEFT JOIN categories c ON d.category_id = c.id ORDER BY d.created_at DESC"
        ),
        db.select<Category[]>("SELECT * FROM categories ORDER BY name"),
      ]);

      // Transform the debts to match our interface (since the query includes category_name)
      const debts = debtsResult.map((debt) => ({
        id: debt.id,
        label: debt.label,
        amountOwed: debt.amount_owed,
        interestRate: debt.interest_rate,
        minimumPayment: debt.minimum_payment,
        dueDate: debt.due_date,
        categoryId: debt.category_id,
        createdAt: debt.created_at,
      }));

      setData({
        debts,
        categories: categoriesResult,
      });
    } catch (err) {
      console.error("Failed to load debts", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Vérifie la base de données.";

      setError(`Impossible de charger les dettes. ${message}`);
      setData({
        debts: [],
        categories: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addDebt = async (debt: Omit<Debt, "id" | "createdAt">) => {
    try {
      const db = await getDb();
      const result = await db.execute(
        "INSERT INTO debts (label, amount_owed, interest_rate, minimum_payment, due_date, category_id) VALUES (?, ?, ?, ?, ?, ?)",
        [
          debt.label,
          debt.amountOwed,
          debt.interestRate || null,
          debt.minimumPayment || null,
          debt.dueDate || null,
          debt.categoryId || null,
        ]
      );

      const debtId = result.lastInsertRowId;
      await load(); // Reload data
      return debtId;
    } catch (err) {
      console.error("Failed to add debt", err);
      throw err;
    }
  };

  const updateDebt = async (
    id: number,
    updates: Partial<Omit<Debt, "id" | "createdAt">>
  ) => {
    try {
      const db = await getDb();

      // Build the SET clause dynamically
      const setClauses = [];
      const values: any[] = [];

      if (updates.label !== undefined) {
        setClauses.push("label = ?");
        values.push(updates.label);
      }
      if (updates.amountOwed !== undefined) {
        setClauses.push("amount_owed = ?");
        values.push(updates.amountOwed);
      }
      if (updates.interestRate !== undefined) {
        setClauses.push("interest_rate = ?");
        values.push(updates.interestRate);
      }
      if (updates.minimumPayment !== undefined) {
        setClauses.push("minimum_payment = ?");
        values.push(updates.minimumPayment);
      }
      if (updates.dueDate !== undefined) {
        setClauses.push("due_date = ?");
        values.push(updates.dueDate);
      }
      if (updates.categoryId !== undefined) {
        setClauses.push("category_id = ?");
        values.push(updates.categoryId);
      }

      if (setClauses.length === 0) return;

      const query = `UPDATE debts SET ${setClauses.join(", ")} WHERE id = ?`;
      values.push(id);

      await db.execute(query, values);
      await load(); // Reload data
    } catch (err) {
      console.error("Failed to update debt", err);
      throw err;
    }
  };

  const deleteDebt = async (id: number) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM debts WHERE id = ?", [id]);
      await load(); // Reload data
    } catch (err) {
      console.error("Failed to delete debt", err);
      throw err;
    }
  };

  return { data, loading, error, refresh: load, addDebt, updateDebt, deleteDebt };
}