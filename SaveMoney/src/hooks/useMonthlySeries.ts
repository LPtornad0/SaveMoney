import { useCallback, useEffect, useState } from "react";
import { getDb, initSchema } from "../db/client";
import { createRequestGate, runLatest } from "../utils/requestGate";
import { fetchSeriesRows, periodMonths, SERIES_LENGTH, type SeriesRows } from "../utils/monthlySeries";

// Reads the period ending at `month`. `revision` changes after every reload of the monthly data
// (create, edit, delete, undo, month change), so the series never lags behind the lists.
// A result that arrives after a newer request, or after an invalidation, is ignored (runLatest).
// This hook does not block the page while it loads: the monthly loading state is unchanged.
export function useMonthlySeries(month: string, revision: unknown) {
  const [rows, setRows] = useState<SeriesRows | null>(null);
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
        return fetchSeriesRows(db, periodMonths(month, SERIES_LENGTH));
      },
      {
        onResult: (result) => setRows(result),
        onError: (err) => {
          console.error("Failed to load monthly series", err);
          const message =
            err instanceof Error && err.message ? err.message : "Vérifie la base de données.";
          // An error is not shown as zeros: the table is replaced by the error
          setError(`Impossible de charger l'évolution. ${message}`);
          setRows(null);
        },
        onSettled: () => setLoading(false),
      }
    );
  }, [month, requests]);

  useEffect(() => {
    load();
    // Results of the previous period are ignored once the month or the monthly data changes
    return () => requests.invalidate();
  }, [load, revision, requests]);

  return { rows, loading, error };
}
