import { useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { getDb } from "../db/client";
import { useMonthlyBudget } from "../hooks/useMonthlyBudget";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error, refresh } = useMonthlyBudget(month);

  // Formulaires
  const [incomeLabel, setIncomeLabel] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeCategory, setIncomeCategory] = useState<string>("");

  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>("");

  const [recurringLabel, setRecurringLabel] = useState("");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringCategory, setRecurringCategory] = useState<string>("");
  const [recurringDay, setRecurringDay] = useState("1");

  if (loading || !data) {
    return <div style={{ padding: "2rem", color: "white" }}>Chargement...</div>;
  }

  if (error) {
    return <div style={{ padding: "2rem", color: "#fca5a5" }}>{error}</div>;
  }

  const incomeCategories = data.categories.filter((c) => c.type === "income");
  const expenseCategories = data.categories.filter((c) => c.type === "expense");

  async function addIncome() {
    if (!incomeLabel || !incomeAmount) return;
    const db = await getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db.execute(
      "INSERT INTO incomes (date, month, label, amount, category_id) VALUES (?, ?, ?, ?, ?)",
      [today, month, incomeLabel, parseFloat(incomeAmount), incomeCategory || null]
    );
    setIncomeLabel("");
    setIncomeAmount("");
    setIncomeCategory("");
    refresh();
  }

  async function addExpense() {
    if (!expenseLabel || !expenseAmount) return;
    const db = await getDb();
    const today = new Date().toISOString().slice(0, 10);
    await db.execute(
      "INSERT INTO expenses (date, month, label, amount, category_id) VALUES (?, ?, ?, ?, ?)",
      [today, month, expenseLabel, parseFloat(expenseAmount), expenseCategory || null]
    );
    setExpenseLabel("");
    setExpenseAmount("");
    setExpenseCategory("");
    refresh();
  }

  async function addRecurring() {
    if (!recurringLabel || !recurringAmount) return;
    const db = await getDb();
    await db.execute(
      "INSERT INTO recurring_expenses (label, amount, category_id, day_of_month, active) VALUES (?, ?, ?, ?, 1)",
      [
        recurringLabel,
        parseFloat(recurringAmount),
        recurringCategory || null,
        parseInt(recurringDay, 10),
      ]
    );
    setRecurringLabel("");
    setRecurringAmount("");
    setRecurringCategory("");
    setRecurringDay("1");
    refresh();
  }

  async function deleteIncome(id: number) {
    const db = await getDb();
    await db.execute("DELETE FROM incomes WHERE id = ?", [id]);
    refresh();
  }

  async function deleteExpense(id: number) {
    const db = await getDb();
    await db.execute("DELETE FROM expenses WHERE id = ?", [id]);
    refresh();
  }

  async function deleteRecurring(id: number) {
    const db = await getDb();
    await db.execute("DELETE FROM recurring_expenses WHERE id = ?", [id]);
    refresh();
  }

  // Helper function to identify savings categories (same as in hook)
  const isSavingsCategory = (categoryName: string) => {
    if (!categoryName) return false;
    const lowerName = categoryName.toLowerCase();
    return lowerName.includes('épargne') ||
           lowerName.includes('savings');
  };

  const expensePerCategory = expenseCategories
    .filter(cat => !isSavingsCategory(cat.name)) // Filter out savings categories
    .map((cat) => {
      const fromExpenses = data.expenses
        .filter((e) => e.category_id === cat.id)
        .reduce((sum, e) => sum + e.amount, 0);
      const fromRecurring = data.recurringExpenses
        .filter((r) => r.category_id === cat.id)
        .reduce((sum, r) => sum + r.amount, 0);
      return { label: cat.name, total: fromExpenses + fromRecurring };
    });

  const chartData = {
    labels: expensePerCategory.map((e) => e.label),
    datasets: [
      {
        label: "Dépenses hors épargne par catégorie (€)",
        data: expensePerCategory.map((e) => e.total),
        backgroundColor: "rgba(54, 162, 235, 0.7)",
      },
    ],
  };

  const cardStyle: React.CSSProperties = {
    background: "#2a2a2a",
    padding: "1rem",
    borderRadius: "12px",
    flex: 1,
  };

  const inputStyle: React.CSSProperties = {
    padding: "0.4rem",
    borderRadius: "6px",
    border: "1px solid #444",
    background: "#1e1e1e",
    color: "white",
    marginRight: "0.5rem",
  };

  const btnStyle: React.CSSProperties = {
    padding: "0.4rem 0.8rem",
    borderRadius: "6px",
    border: "none",
    background: "#3b82f6",
    color: "white",
    cursor: "pointer",
  };

  return (
    <main style={{ padding: "2rem", color: "white", background: "#111", minHeight: "100vh" }}>
      <h1>SaveMoney</h1>

      <div style={{ marginBottom: "1.5rem" }}>
        <label>Mois : </label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Blocs résumé */}
      <section style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
        <div style={{ ...cardStyle, background: "#1b3a4b" }}>
          <h3>Revenus</h3>
          <p style={{ fontSize: "1.4rem" }}>{data.totalIncome.toFixed(2)} €</p>
        </div>
        <div style={{ ...cardStyle, background: "#4b1b1b" }}>
          <h3>Dépenses du mois</h3>
          <p style={{ fontSize: "1.4rem" }}>{data.totalExpense.toFixed(2)} €</p>
        </div>
        <div style={{ ...cardStyle, background: "#4b3a1b" }}>
          <h3>Charges fixes</h3>
          <p style={{ fontSize: "1.4rem" }}>{data.totalRecurring.toFixed(2)} €</p>
        </div>
        <div style={{ ...cardStyle, background: "#1b4b2a" }}>
          <h3>Disponible</h3>
          <p style={{ fontSize: "1.4rem" }}>{data.available.toFixed(2)} €</p>
        </div>
        <div style={{ ...cardStyle, background: "#1b4b2a" }}>
          <h3>Épargne</h3>
          <p style={{ fontSize: "1.4rem" }}>{data.totalSavings.toFixed(2)} €</p>
        </div>
      </section>

      {/* Graphique */}
      <section style={{ maxWidth: 700, marginBottom: "2rem" }}>
        <h2>Dépenses par catégorie</h2>
        <Bar data={chartData} />
      </section>

      {/* Formulaires */}
      <section style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        {/* Revenu */}
        <div style={cardStyle}>
          <h3>Ajouter un revenu</h3>
          <input
            style={inputStyle}
            placeholder="Libellé"
            value={incomeLabel}
            onChange={(e) => setIncomeLabel(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Montant"
            type="number"
            value={incomeAmount}
            onChange={(e) => setIncomeAmount(e.target.value)}
          />
          <select
            style={inputStyle}
            value={incomeCategory}
            onChange={(e) => setIncomeCategory(e.target.value)}
          >
            <option value="">Catégorie</option>
            {incomeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button style={btnStyle} onClick={addIncome}>
            Ajouter
          </button>

          <ul>
            {data.incomes.map((i) => (
              <li key={i.id} style={{ marginBottom: "0.5rem" }}>
                {i.label} — {i.amount.toFixed(2)} €{" "}
                <button style={{ ...btnStyle, background: "#b91c1c" }} onClick={() => deleteIncome(i.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Dépense ponctuelle */}
        <div style={cardStyle}>
          <h3>Ajouter une dépense</h3>
          <input
            style={inputStyle}
            placeholder="Libellé"
            value={expenseLabel}
            onChange={(e) => setExpenseLabel(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Montant"
            type="number"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
          />
          <select
            style={inputStyle}
            value={expenseCategory}
            onChange={(e) => setExpenseCategory(e.target.value)}
          >
            <option value="">Catégorie</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button style={btnStyle} onClick={addExpense}>
            Ajouter
          </button>

          <ul>
            {data.expenses.map((e) => (
              <li key={e.id} style={{ marginBottom: "0.5rem" }}>
                {e.label} — {e.amount.toFixed(2)} €{" "}
                <button style={{ ...btnStyle, background: "#b91c1c" }} onClick={() => deleteExpense(e.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Dépense récurrente */}
                {/* Dépense récurrente */}
        <div style={cardStyle}>
          <h3>Ajouter une charge fixe</h3>
          <input
            style={inputStyle}
            placeholder="Libellé"
            value={recurringLabel}
            onChange={(e) => setRecurringLabel(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Montant"
            type="number"
            value={recurringAmount}
            onChange={(e) => setRecurringAmount(e.target.value)}
          />
          <select
            style={inputStyle}
            value={recurringCategory}
            onChange={(e) => setRecurringCategory(e.target.value)}
          >
            <option value="">Catégorie</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            style={{ ...inputStyle, width: "60px" }}
            placeholder="Jour"
            type="number"
            min="1"
            max="31"
            value={recurringDay}
            onChange={(e) => setRecurringDay(e.target.value)}
          />
          <button style={btnStyle} onClick={addRecurring}>
            Ajouter
          </button>

          <ul>
            {data.recurringExpenses.map((r) => (
              <li key={r.id} style={{ marginBottom: "0.5rem" }}>
                {r.label} — {r.amount.toFixed(2)} € (jour {r.day_of_month}){" "}
                <button
                  style={{ ...btnStyle, background: "#b91c1c" }}
                  onClick={() => deleteRecurring(r.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}