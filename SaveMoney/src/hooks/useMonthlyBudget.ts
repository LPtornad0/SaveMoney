import { useEffect, useState, useCallback } from "react";
import { getDb, initSchema } from "../db/client";
import { emptyMonthBudget, fetchMonthBudget, type MonthlyBudgetData } from "../utils/monthBudget";
import { createRequestGate, runLatest } from "../utils/requestGate";

export type { MonthlyBudgetData } from "../utils/monthBudget";

export function useMonthlyBudget(month: string) {
  const [data, setData] = useState<MonthlyBudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(createRequestGate);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    await runLatest(
      requests,
      async () => {
        const db = await getDb();
        await initSchema();
        return fetchMonthBudget(db, month);
      },
      {
        onResult: (result) => setData(result),
        onError: (err) => {
          console.error("Failed to load monthly budget", err);
          const message =
            err instanceof Error && err.message
              ? err.message
              : "Vérifie la base de données.";

          setError(`Impossible de charger les données. ${message}`);
          setData(emptyMonthBudget());
        },
        onSettled: () => setLoading(false),
      }
    );
  }, [month, requests]);

  useEffect(() => {
    load();
    // Results of the previous month are ignored once the month changes or the component unmounts
    return () => requests.invalidate();
  }, [load, requests]);

  return { data, loading, error, refresh: load };
}
