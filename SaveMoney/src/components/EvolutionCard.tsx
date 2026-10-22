import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { formatEUR } from "../utils/formatEUR";
import type { MonthlySeriesRow, MonthStatus } from "../utils/monthlySeries";

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const INCOME_COLOR = "#3B82F6";
const EXPENSE_COLOR = "#EF4444";
const STATUS_NOTE: Record<MonthStatus, string> = {
  none: "Aucune donnée enregistrée (ce n'est pas une validation du mois).",
  "savings-only": "Aucun revenu ni dépense ponctuelle enregistré ; épargne exclue.",
  "pending-only": "Opérations en attente de suppression, exclues de la courbe.",
  recorded: "Enregistrées",
};

export interface EvolutionCardProps {
  selectedMonth: string;
  rows: MonthlySeriesRow[] | null;
  error: string | null;
}

function formatShortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

// Revenues and one-off expenses over the period. The table carries the values for every reader;
// the chart is decorative and hidden from assistive technology. The selected month is marked by text
// and a larger point, not by colour alone. The two series differ by line style and point shape too.
export function EvolutionCard({ selectedMonth, rows, error }: EvolutionCardProps) {
  const title = "Évolution sur 6 mois";

  if (error) {
    return (
      <section className="chart-card evolution-card" aria-labelledby="evolution-title">
        <h2 id="evolution-title">{title}</h2>
        <p role="alert" className="field-error">{error}</p>
      </section>
    );
  }

  if (rows === null) {
    return (
      <section className="chart-card evolution-card" aria-labelledby="evolution-title">
        <h2 id="evolution-title">{title}</h2>
        <p className="ops-empty">Chargement de l'évolution…</p>
      </section>
    );
  }

  const labelOf = (row: MonthlySeriesRow) =>
    row.month === selectedMonth ? `${formatShortMonth(row.month)} (affiché)` : formatShortMonth(row.month);
  // The chart is replaced by the message only when no month holds any record at all
  const allEmpty = rows.every((row) => row.status === "none");
  const pointRadius = rows.map((row) => (row.month === selectedMonth ? 7 : 4));

  const chartData = {
    labels: rows.map(labelOf),
    datasets: [
      {
        label: "Revenus",
        data: rows.map((row) => row.revenus),
        borderColor: INCOME_COLOR,
        backgroundColor: INCOME_COLOR,
        pointStyle: "circle" as const,
        pointRadius,
        borderWidth: 2,
      },
      {
        label: "Dépenses ponctuelles",
        data: rows.map((row) => row.depensesPonctuelles),
        borderColor: EXPENSE_COLOR,
        backgroundColor: EXPENSE_COLOR,
        borderDash: [6, 4],
        pointStyle: "triangle" as const,
        pointRadius,
        borderWidth: 2,
      },
    ],
  };

  const chartOptions: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: true, position: "bottom" },
      tooltip: {
        backgroundColor: "#1A1A1C",
        borderColor: "#2A2A2D",
        borderWidth: 1,
        titleColor: "#FFFFFF",
        bodyColor: "#FFFFFF",
        callbacks: {
          label: (context) => `${context.dataset.label} : ${formatEUR(Number(context.parsed.y))}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        beginAtZero: true,
        grid: { color: "#2A2A2D" },
        ticks: { callback: (value) => formatEUR(Number(value)) },
      },
    },
    // No onClick: the card never changes the month, the filter or an edit
  };

  return (
    <section className="chart-card evolution-card" aria-labelledby="evolution-title">
      <h2 id="evolution-title">{title}</h2>
      <p className="evolution-scope">Hors charges fixes et épargne.</p>

      {allEmpty ? (
        <p className="evolution-empty">Aucune donnée enregistrée sur ces six mois.</p>
      ) : (
        <div className="evolution-chart" aria-hidden="true">
          <Line data={chartData} options={chartOptions} />
        </div>
      )}

      <div className="evolution-table-wrap" role="region" aria-label="Tableau de l'évolution sur 6 mois" tabIndex={0}>
        <table className="evolution-table">
          <caption>Revenus et dépenses ponctuelles par mois</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">Revenus</th>
              <th scope="col">Dépenses ponctuelles</th>
              <th scope="col">Données</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = row.month === selectedMonth;
              return (
                <tr key={row.month} aria-current={selected ? "date" : undefined}>
                  <th scope="row">{labelOf(row)}</th>
                  <td>{formatEUR(row.revenus)}</td>
                  <td>{formatEUR(row.depensesPonctuelles)}</td>
                  <td>{STATUS_NOTE[row.status]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
