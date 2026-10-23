import { useEffect, useState, useCallback } from "react";
import { getDb, initSchema } from "../db/client";
import type { Goal, Category } from "../types/budget";

interface GoalRow {
  id: number;
  label: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  category_id: number | null;
  created_at: string;
}

export interface GoalsData {
  goals: Goal[];
  categories: Category[];
}

export function useGoals() {
  const [data, setData] = useState<GoalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const db = await getDb();
      await initSchema();

      const [goalsResult, categoriesResult] = await Promise.all([
        db.select<GoalRow[]>(
          "SELECT g.*, c.name as category_name FROM goals g LEFT JOIN categories c ON g.category_id = c.id ORDER BY g.created_at DESC"
        ),
        db.select<Category[]>("SELECT * FROM categories ORDER BY name"),
      ]);

      // Transform the goals to match our interface (since the query includes category_name)
      const goals = goalsResult.map((goal) => ({
        id: goal.id,
        label: goal.label,
        targetAmount: goal.target_amount,
        currentAmount: goal.current_amount,
        targetDate: goal.target_date ?? undefined,
        categoryId: goal.category_id ?? undefined,
        createdAt: goal.created_at,
      }));

      setData({
        goals,
        categories: categoriesResult,
      });
    } catch (err) {
      console.error("Failed to load goals", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Vérifie la base de données.";

      setError(`Impossible de charger les objectifs. ${message}`);
      setData({
        goals: [],
        categories: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addGoal = async (goal: Omit<Goal, "id" | "createdAt">) => {
    try {
      const db = await getDb();
      const result = await db.execute(
        "INSERT INTO goals (label, target_amount, current_amount, target_date, category_id) VALUES (?, ?, ?, ?, ?)",
        [goal.label, goal.targetAmount, goal.currentAmount, goal.targetDate || null, goal.categoryId || null]
      );

      const goalId = result.lastInsertId;
      await load(); // Reload data
      return goalId;
    } catch (err) {
      console.error("Failed to add goal", err);
      throw err;
    }
  };

  const updateGoal = async (id: number, updates: Partial<Omit<Goal, "id" | "createdAt">>) => {
    try {
      const db = await getDb();

      // Build the SET clause dynamically
      const setClauses = [];
      const values: any[] = [];

      if (updates.label !== undefined) {
        setClauses.push("label = ?");
        values.push(updates.label);
      }
      if (updates.targetAmount !== undefined) {
        setClauses.push("target_amount = ?");
        values.push(updates.targetAmount);
      }
      if (updates.currentAmount !== undefined) {
        setClauses.push("current_amount = ?");
        values.push(updates.currentAmount);
      }
      if (updates.targetDate !== undefined) {
        setClauses.push("target_date = ?");
        values.push(updates.targetDate);
      }
      if (updates.categoryId !== undefined) {
        setClauses.push("category_id = ?");
        values.push(updates.categoryId);
      }

      if (setClauses.length === 0) return;

      const query = `UPDATE goals SET ${setClauses.join(", ")} WHERE id = ?`;
      values.push(id);

      await db.execute(query, values);
      await load(); // Reload data
    } catch (err) {
      console.error("Failed to update goal", err);
      throw err;
    }
  };

  const deleteGoal = async (id: number) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM goals WHERE id = ?", [id]);
      await load(); // Reload data
    } catch (err) {
      console.error("Failed to delete goal", err);
      throw err;
    }
  };

  return { data, loading, error, refresh: load, addGoal, updateGoal, deleteGoal };
}