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
import { useGoals } from "../hooks/useGoals";
import { useDebts } from "../hooks/useDebts";
import { formatEUR } from "../utils/formatEUR";
import type { Goal, Debt } from "../types/budget";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error, refresh } = useMonthlyBudget(month);
  const { data: goalsData, loading: goalsLoading, error: goalsError, refresh: refreshGoals, addGoal } = useGoals();
  const { data: debtsData, loading: debtsLoading, error: debtsError, refresh: refreshDebts, addDebt } = useDebts();

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

  // Goal form state
  const [goalLabel, setGoalLabel] = useState("");
  const [goalTargetAmount, setGoalTargetAmount] = useState(0);
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalCategoryId, setGoalCategoryId] = useState<number | undefined>(undefined);

  // Debt form state
  const [debtLabel, setDebtLabel] = useState("");
  const [debtAmount, setDebtAmount] = useState(0);
  const [debtInterest, setDebtInterest] = useState<number | undefined>(undefined);
  const [debtMinimumPayment, setDebtMinimumPayment] = useState<number | undefined>(undefined);
  const [debtDueDate, setDebtDueDate] = useState("");
  const [debtCategoryId, setDebtCategoryId] = useState<number | undefined>(undefined);

  if ((loading || goalsLoading || debtsLoading) || (!data && !goalsData && !debtsData)) {
    return <div style={{ padding: "2rem", color: "white" }}>Chargement...</div>;
  }

  if (error || goalsError || debtsError) {
    return <div style={{ padding: "2rem", color: "#fca5a5" }}>{error || goalsError || debtsError}</div>;
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

  async function addNewGoal() {
    if (!goalLabel || goalTargetAmount <= 0) return;
    try {
      await addGoal({
        label: goalLabel,
        targetAmount: goalTargetAmount,
        currentAmount: 0,
        targetDate: goalTargetDate || undefined,
        categoryId: goalCategoryId
      });

      // Reset form
      setGoalLabel("");
      setGoalTargetAmount(0);
      setGoalTargetDate("");
      setGoalCategoryId(undefined);

      // Refresh goals data
      await refreshGoals();
    } catch (err) {
      console.error("Failed to add goal", err);
      alert("Erreur lors de la création de l'objectif: " + err);
    }
  }

  async function addNewDebt() {
    if (!debtLabel || debtAmount <= 0) return;
    try {
      await addDebt({
        label: debtLabel,
        amountOwed: debtAmount,
        interestRate: debtInterest,
        minimumPayment: debtMinimumPayment,
        dueDate: debtDueDate,
        categoryId: debtCategoryId
      });

      // Reset form
      setDebtLabel("");
      setDebtAmount(0);
      setDebtInterest(undefined);
      setDebtMinimumPayment(undefined);
      setDebtDueDate("");
      setDebtCategoryId(undefined);

      // Refresh debts data
      await refreshDebts();
    } catch (err) {
      console.error("Failed to add debt", err);
      alert("Erreur lors de la création de la dette: " + err);
    }
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

  // Helper function to calculate percentage safely
  const calculatePercentage = (value: number, total: number): number => {
    return total > 0 ? (value / total) * 100 : 0;
  };

  // Helper function to format goal progress
  const formatGoalProgress = (current: number, target: number): string => {
    return `${formatEUR(current)} / ${formatEUR(target)}`;
  };

  // Helper function to format debt payoff progress
  const formatDebtProgress = (paid: number, owed: number): string => {
    return `${formatEUR(paid)} / ${formatEUR(owed)}`;
  };

  // Helper function to calculate debt payoff percentage
  const calculateDebtPayoffPercentage = (amountOwed: number, originalAmount: number): number => {
    // This would typically track how much has been paid off vs original amount
    // For simplicity, we'll just show what percentage of the original debt remains
    // In a real app, you'd track payment history
    if (originalAmount <= 0) return 0;
    const paidOff = Math.max(0, originalAmount - amountOwed);
    return (paidOff / originalAmount) * 100;
  };

  // Helper function to format variation with + or - sign
  const formatVariation = (value: number | undefined): string => {
    if (value === undefined) return '';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${formatEUR(value)}`;
  };

  // Helper function to get variation color (green for positive, red for negative)
  const getVariationColor = (value: number | undefined): string => {
    if (value === undefined) return 'var(--text-secondary)';
    return value >= 0 ? 'var(--color-income)' : 'var(--color-expense)';
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
    background: 'var(--surface-card)',
    padding: 'var(--spacing-3)',
    borderRadius: "12px",
    flex: 1,
  };

  const inputStyle: React.CSSProperties = {
    padding: 'var(--spacing-2)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    marginRight: 'var(--spacing-2)',
  };

  const btnStyle: React.CSSProperties = {
    padding: 'var(--spacing-2) var(--spacing-3)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--color-income)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  };

  return (
    <main style={{
      padding: 'var(--spacing-5)',
      color: 'var(--text-primary)',
      background: 'var(--surface-background)',
      minHeight: "100vh"
    }}>
      <h1>SaveMoney</h1>

      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <label>Mois : </label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Blocs résumé */}
      <section style={{ display: "flex", gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-5)' }}>
        <div style={{ ...cardStyle, background: 'var(--color-available)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a7 7 0 0 0-7 7c0 4 5 9 9 9s9-5 9-9c0-4-5-9-9-9zm0 10c-3 0-5-2-5-5s2-5 5-5 5 2 5 5-2 5-5 5z"/>
            </svg>
            <h3>Disponible</h3>
          </div>
            <div
              title="Disponible = Revenus - Dépenses - Charges fixes - Épargne"
              style={{
                cursor: 'help',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                marginLeft: 'var(--spacing-1)'
              }}
            >
              ⓘ
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-2xl)' }}>{formatEUR(data.available)}</p>
          {data.variationAvailable !== undefined && (
            <p style={{
              fontSize: 'var(--text-lg)',
              color: getVariationColor(data.variationAvailable),
              margin: 'var(--spacing-1) 0'
            }}>
              {formatVariation(data.variationAvailable)} vs mois précédent
            </p>
          )}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calculatePercentage(data.available, data.totalIncome).toFixed(0)}% du revenu
          </p>
        </div>
        <div style={{ ...cardStyle, background: 'var(--color-income)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5h-9c-.83 0-1.5.67-1.5 1.5v3.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-6 9H4v-2h4v2z"/>
            </svg>
            <h3>Revenus</h3>
          </div>
          <p style={{ fontSize: 'var(--text-2xl)' }}>{formatEUR(data.totalIncome)}</p>
          {data.variationIncome !== undefined && (
            <p style={{
              fontSize: 'var(--text-lg)',
              color: getVariationColor(data.variationIncome),
              margin: 'var(--spacing-1) 0'
            }}>
              {formatVariation(data.variationIncome)} vs mois précédent
            </p>
          )}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            100% du revenu
          </p>
        </div>
        <div style={{ ...cardStyle, background: 'var(--color-expense)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 13H5v-2h14v2zm0-4H5V9h14v2zm0-4H5V5h14v2z"/>
            </svg>
            <h3>Dépenses du mois</h3>
          </div>
          <p style={{ fontSize: 'var(--text-2xl)' }}>{formatEUR(data.totalExpense)}</p>
          {data.variationExpense !== undefined && (
            <p style={{
              fontSize: 'var(--text-lg)',
              color: getVariationColor(data.variationExpense),
              margin: 'var(--spacing-1) 0'
            }}>
              {formatVariation(data.variationExpense)} vs mois précédent
            </p>
          )}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calculatePercentage(data.totalExpense, data.totalIncome).toFixed(0)}% du revenu
          </p>
        </div>
        <div style={{ ...cardStyle, background: 'var(--color-recurring)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4a8 8 0 0 1 8 8c0 3.59-2.56 6.5-6 7.66V20H4v-3.34C2.56 14.5 0 11.59 0 8a8 8 0 0 1 8-8zm0 14c-3.31 0-6-2.69-6-6h12c0 3.31-2.69 6-6 6z"/>
            </svg>
            <h3>Charges fixes</h3>
          </div>
          <p style={{ fontSize: 'var(--text-2xl)' }}>{formatEUR(data.totalRecurring)}</p>
          {data.variationRecurring !== undefined && (
            <p style={{
              fontSize: 'var(--text-lg)',
              color: getVariationColor(data.variationRecurring),
              margin: 'var(--spacing-1) 0'
            }}>
              {formatVariation(data.variationRecurring)} vs mois précédent
            </p>
          )}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calculatePercentage(data.totalRecurring, data.totalIncome).toFixed(0)}% du revenu
          </p>
        </div>
        <div style={{ ...cardStyle, background: 'var(--color-savings)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 12a8 8 0 0 0-16 0H4a4 4 0 0 0 0 8h16a4 4 0 0 0 0-8h-4zm0 4a2 2 0 0 1-4 0 2 2 0 0 0-4 0H8a6 6 0 0 1 12 0h-4a2 2 0 0 1-4 0z"/>
            </svg>
            <h3>Épargne</h3>
          </div>
          <p style={{ fontSize: 'var(--text-2xl)' }}>{formatEUR(data.totalSavings)}</p>
          {data.variationSavings !== undefined && (
            <p style={{
              fontSize: 'var(--text-lg)',
              color: getVariationColor(data.variationSavings),
              margin: 'var(--spacing-1) 0'
            }}>
              {formatVariation(data.variationSavings)} vs mois précédent
            </p>
          )}
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calculatePercentage(data.totalSavings, data.totalIncome).toFixed(0)}% du revenu
          </p>
        </div>
      </section>

      {/* Objectifs */}
      <section style={{ marginBottom: 'var(--spacing-5)' }}>
        <h2>Objectifs d'épargne</h2>
        {goalsData?.goals.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--spacing-4)' }}>
            Aucun objectif défini. Ajoutez votre premier objectif ci-dessous.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 'var(--spacing-3)', flexWrap: "wrap" }}>
            {goalsData?.goals.map((goal) => {
              const categoryName = goalsData?.categories
                .find(cat => cat.id === goal.categoryId)?.name || "Sans catégorie";
              const progressPercentage = Math.min(calculatePercentage(goal.currentAmount, goal.targetAmount), 100);

              return (
                <div key={goal.id} style={{
                  flex: 1,
                  minWidth: "200px",
                  background: 'var(--surface-card)',
                  padding: 'var(--spacing-3)',
                  borderRadius: "12px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-1)' }}>
                    <h4 style={{ margin: 0 }}>{goal.label}</h4>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{categoryName}</span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '8px',
                    background: 'var(--surface-border)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: 'var(--spacing-2)'
                  }}>
                    <div style={{
                      width: `${progressPercentage}%`,
                      height: '100%',
                      background: progressPercentage >= 100 ? 'var(--color-income)' : 'var(--color-savings)',
                      transition: 'width 0.3s ease'
                    }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    <span>{formatGoalProgress(goal.currentAmount, goal.targetAmount)}</span>
                    <span>{progressPercentage.toFixed(0)}%</span>
                  </div>
                  {goal.targetDate && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--spacing-1)' }}>
                      Objectif pour le {new Date(goal.targetDate).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Dettes */}
      <section style={{ marginBottom: 'var(--spacing-5)' }}>
        <h2>Dettes et passifs</h2>
        {debtsData?.debts.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--spacing-4)' }}>
            Aucune dette enregistrée. Ajoutez votre première dette ci-dessous.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 'var(--spacing-3)', flexWrap: "wrap" }}>
            {debtsData?.debts.map((debt) => {
              const categoryName = debtsData?.categories
                .find(cat => cat.id === debt.categoryId)?.name || "Sans catégorie";

              return (
                <div key={debt.id} style={{
                  flex: 1,
                  minWidth: "200px",
                  background: 'var(--surface-card)',
                  padding: 'var(--spacing-3)',
                  borderRadius: "12px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-1)' }}>
                    <h4 style={{ margin: 0 }}>{debt.label}</h4>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{categoryName}</span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '8px',
                    background: 'var(--surface-border)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: 'var(--spacing-2)'
                  }}>
                    <div style={{
                      width: '100%', // For now, showing full amount owed (in a real app, this would show paid off portion)
                      height: '100%',
                      background: 'var(--color-expense)',
                      transition: 'width 0.3s ease'
                    }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    <span>Montant dû: {formatEUR(debt.amountOwed)}</span>
                    {debt.interestRate !== undefined && (
                      <span>Taux: {debt.interestRate}%</span>
                    )}
                  </div>
                  {debt.dueDate && (
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--spacing-1)' }}>
                      Échéance: {new Date(debt.dueDate).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Formulaire d'ajout de dette */}
        <div style={{
          marginTop: 'var(--spacing-4)',
          padding: 'var(--spacing-3)',
          background: 'var(--surface-card)',
          borderRadius: '12px'
        }}>
          <h3>Nouvelle dette</h3>
          <div style={{ display: "grid", gap: 'var(--spacing-2)', gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <input
              placeholder="Nom de la dette"
              id="debt-label-input"
              style={inputStyle}
              value={debtLabel}
              onChange={(e) => setDebtLabel(e.target.value)}
            />
            <input
              placeholder="Montant dû"
              type="number"
              id="debt-amount-input"
              style={inputStyle}
              value={debtAmount}
              onChange={(e) => setDebtAmount(parseFloat(e.target.value) || 0)}
            />
            <input
              placeholder="Taux d'intérêt (%)"
              type="number"
              id="debt-interest-input"
              style={inputStyle}
              value={debtInterest}
              onChange={(e) => setDebtInterest(parseFloat(e.target.value) || undefined)}
            />
            <input
              placeholder="Paiement minimum"
              type="number"
              id="debt-minimum-input"
              style={inputStyle}
              value={debtMinimumPayment}
              onChange={(e) => setDebtMinimumPayment(parseFloat(e.target.value) || undefined)}
            />
            <input
              placeholder="Date d'échéance"
              type="date"
              id="debt-due-date-input"
              style={inputStyle}
              value={debtDueDate}
              onChange={(e) => setDebtDueDate(e.target.value)}
            />
            <select
              id="debt-category-input"
              style={inputStyle}
              value={debtCategoryId}
              onChange={(e) => setDebtCategoryId(e.target.value ? parseInt(e.target.value) : undefined)}
            >
              <option value="">Catégorie (optionnel)</option>
              {expenseCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                const labelInput = document.getElementById('debt-label-input') as HTMLInputElement;
                const amountInput = document.getElementById('debt-amount-input') as HTMLInputElement;
                const interestInput = document.getElementById('debt-interest-input') as HTMLInputElement;
                const minimumInput = document.getElementById('debt-minimum-input') as HTMLInputElement;
                const dueDateInput = document.getElementById('debt-due-date-input') as HTMLInputElement;
                const categorySelect = document.getElementById('debt-category-input') as HTMLSelectElement;

                const label = labelInput.value.trim();
                const amount = parseFloat(amountInput.value);
                const interestRate = parseFloat(interestInput.value) || undefined;
                const minimumPayment = parseFloat(minimumInput.value) || undefined;
                const dueDate = dueDateInput.value || undefined;
                const categoryId = categorySelect.value ? parseInt(categorySelect.value) : undefined;

                if (!label || isNaN(amount) || amount <= 0) {
                  alert('Veuillez remplir correctement les champs requis');
                  return;
                }

                try {
                  await addDebt({
                    label,
                    amountOwed: amount,
                    interestRate,
                    minimumPayment,
                    dueDate,
                    categoryId
                  });

                  // Reset form
                  setDebtLabel("");
                  setDebtAmount(0);
                  setDebtInterest(undefined);
                  setDebtMinimumPayment(undefined);
                  setDebtDueDate("");
                  setDebtCategoryId(undefined);

                  // Refresh debts data
                  await refreshDebts();
                } catch (err) {
                  alert('Erreur lors de la création de la dette: ' + err);
                }
              }}
              style={btnStyle}
            >
              Ajouter la dette
            </button>
          </div>
        </div>
      </section>

      {/* Graphique */}
      <section style={{ maxWidth: 700, marginBottom: 'var(--spacing-5)' }}>
        <h2>Dépenses par catégorie</h2>
        <Bar data={chartData} />
      </section>

      {/* Formulaires */}
      <section style={{ display: "flex", gap: 'var(--spacing-5)', flexWrap: "wrap", marginBottom: 'var(--spacing-5)' }}>
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
              <li key={i.id} style={{ marginBottom: 'var(--spacing-2)' }}>
                {i.label} — {formatEUR(i.amount)} {" "}
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
              <li key={e.id} style={{ marginBottom: 'var(--spacing-2)' }}>
                {e.label} — {formatEUR(e.amount)} {" "}
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
              <li key={r.id} style={{ marginBottom: 'var(--spacing-2)' }}>
                {r.label} — {formatEUR(r.amount)} € (jour {r.day_of_month}){" "}
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

        {/* Objectif d'épargne */}
        <div style={cardStyle}>
          <h3>Nouvel objectif d'épargne</h3>
          <input
            placeholder="Nom de l'objectif"
            id="goal-label-input"
            style={inputStyle}
            value={goalLabel}
            onChange={(e) => setGoalLabel(e.target.value)}
          />
          <input
            placeholder="Montant cible"
            type="number"
            id="goal-target-amount-input"
            style={inputStyle}
            value={goalTargetAmount}
            onChange={(e) => setGoalTargetAmount(parseFloat(e.target.value) || 0)}
          />
          <input
            placeholder="Date cible (optionnel)"
            type="date"
            id="goal-target-date-input"
            style={inputStyle}
            value={goalTargetDate}
            onChange={(e) => setGoalTargetDate(e.target.value)}
          />
          <select
            id="goal-category-input"
            style={inputStyle}
            value={goalCategoryId}
            onChange={(e) => setGoalCategoryId(e.target.value ? parseInt(e.target.value) : undefined)}
          >
            <option value="">Catégorie (optionnel)</option>
            {expenseCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <button style={btnStyle} onClick={addNewGoal}>
            Ajouter l'objectif
          </button>
        </div>
      </section>
    </main>
  );
}