import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { isValidCalendarDate, monthOfDate, parseAmount, parseDayOfMonth } from "../utils/formValidation";
import { DeferredDeletionQueue, type DeletableType, type PendingDeletion } from "../utils/deferredDeletions";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

type FormKind = "income" | "expense" | "recurring";

const LABEL_REQUIRED = "Le libellé est requis";
const AMOUNT_INVALID = "Saisissez un montant supérieur à 0";
const DATE_REQUIRED = "Choisissez une date valide";
const DAY_INVALID = "Saisissez un jour entier entre 1 et 31";
const SAVE_ERROR_MESSAGE = "L'enregistrement a échoué. Vos saisies sont conservées.";
const DELETE_FAILED_MESSAGE = "La suppression a échoué. La ligne est restée enregistrée.";

const DELETE_SQL: Record<DeletableType, string> = {
  income: "DELETE FROM incomes WHERE id = ?",
  expense: "DELETE FROM expenses WHERE id = ?",
  recurring: "DELETE FROM recurring_expenses WHERE id = ?",
};

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

// Rendered outside the loading guard so a toast stays visible while data reloads.
function ToastRegion({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => {
        const action = toast.action;
        return (
          <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className={`toast toast-${toast.tone}`}>
            <span>{toast.message}</span>
            {action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  action.run();
                  onDismiss(toast.id);
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatMonthLabel(yearMonth: string): string {
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
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
  const [expenseDate, setExpenseDate] = useState("");
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

  // Form validation states
  const [incomeLabelError, setIncomeLabelError] = useState("");
  const [incomeAmountError, setIncomeAmountError] = useState("");
  const [expenseLabelError, setExpenseLabelError] = useState("");
  const [expenseAmountError, setExpenseAmountError] = useState("");
  const [expenseDateError, setExpenseDateError] = useState("");
  const [recurringLabelError, setRecurringLabelError] = useState("");
  const [recurringAmountError, setRecurringAmountError] = useState("");
  const [recurringDayError, setRecurringDayError] = useState("");
  const [goalLabelError, setGoalLabelError] = useState("");
  const [goalTargetAmountError, setGoalTargetAmountError] = useState("");
  const [debtLabelError, setDebtLabelError] = useState("");
  const [debtAmountError, setDebtAmountError] = useState("");
  const [debtInterestError, setDebtInterestError] = useState("");
  const [debtMinimumPaymentError, setDebtMinimumPaymentError] = useState("");
  const [debtDueDateError, setDebtDueDateError] = useState("");

  // Pending deletions for undo feature
  // Rows hidden while their deletion can still be undone
  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletion[]>([]);

  // Active category filter (from chart click)
  const [activeFilterCategory, setActiveFilterCategory] = useState<string | null>(null);

  // Save state: the ref blocks a second submit before React re-renders
  const savingRef = useRef(false);
  const [savingForm, setSavingForm] = useState<FormKind | null>(null);
  const [formError, setFormError] = useState<{ form: FormKind; message: string } | null>(null);
  const incomeLabelRef = useRef<HTMLInputElement>(null);
  const expenseLabelRef = useRef<HTMLInputElement>(null);
  const recurringLabelRef = useRef<HTMLInputElement>(null);

  // Focus requested by a successful save, applied once the data has reloaded
  const pendingFocusRef = useRef<FormKind | null>(null);

  // Toasts are React state, each with its own timer
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // The form unmounts while data reloads, so focus waits for the reloaded form
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target || loading || !data) return;
    const input =
      target === "income" ? incomeLabelRef.current
      : target === "expense" ? expenseLabelRef.current
      : recurringLabelRef.current;
    input?.focus();
    pendingFocusRef.current = null;
  }, [loading, data]);

  const dismissToast = (id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: ToastTone = "success", action?: ToastItem["action"], durationMs = 3000) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone, action }]);
    toastTimersRef.current.set(id, setTimeout(() => dismissToast(id), durationMs));
  };

  // Deletions can finish after a month change, so they must reach the latest refresh
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const [deletionQueue] = useState(
    () =>
      new DeferredDeletionQueue({
        delayMs: 5000,
        schedule: (run, delayMs) => setTimeout(run, delayMs),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        execute: async (type, id) => {
          const db = await getDb();
          await db.execute(DELETE_SQL[type], [id]);
        },
        onChange: setPendingDeletions,
        onSuccess: () => refreshRef.current(),
        onFailure: () => showToast(DELETE_FAILED_MESSAGE, "error"),
      })
  );

  if (loading || goalsLoading || debtsLoading || !data || !goalsData || !debtsData) {
    return (
      <>
        <div style={{ padding: "2rem", color: "white" }}>Chargement...</div>
        <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (error || goalsError || debtsError) {
    return (
      <>
        <div style={{ padding: "2rem", color: "#fca5a5" }}>{error || goalsError || debtsError}</div>
        <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const incomeCategories = data.categories.filter((c) => c.type === "income");
  const expenseCategories = data.categories.filter((c) => c.type === "expense");

  // Filter data based on active category filter
  const filteredIncomes = activeFilterCategory
    ? data.incomes.filter(income => {
        const category = data.categories.find(cat => cat.id === income.category_id);
        return category && category.name === activeFilterCategory;
      })
    : data.incomes;

  const filteredExpenses = activeFilterCategory
    ? data.expenses.filter(expense => {
        const category = data.categories.find(cat => cat.id === expense.category_id);
        return category && category.name === activeFilterCategory;
      })
    : data.expenses;

  const filteredRecurringExpenses = activeFilterCategory
    ? data.recurringExpenses.filter(recurring => {
        const category = data.categories.find(cat => cat.id === recurring.category_id);
        return category && category.name === activeFilterCategory;
      })
    : data.recurringExpenses;

  // Runs one save at a time; a second submit while saving is ignored.
  async function runSave(form: FormKind, save: () => Promise<void>): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSavingForm(form);
    setFormError(null);
    try {
      await save();
      return true;
    } catch (err) {
      console.error(`Failed to save ${form}`, err);
      setFormError({ form, message: SAVE_ERROR_MESSAGE });
      showToast(SAVE_ERROR_MESSAGE, "error");
      return false;
    } finally {
      savingRef.current = false;
      setSavingForm(null);
    }
  }

  async function handleIncomeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = incomeLabel.trim();
    const amount = parseAmount(incomeAmount);
    setIncomeLabelError(label ? "" : LABEL_REQUIRED);
    setIncomeAmountError(amount === null ? AMOUNT_INVALID : "");
    if (!label || amount === null) return;

    const saved = await runSave("income", async () => {
      const db = await getDb();
      const today = new Date().toISOString().slice(0, 10);
      await db.execute(
        "INSERT INTO incomes (date, month, label, amount, category_id) VALUES (?, ?, ?, ?, ?)",
        [today, month, label, amount, incomeCategory || null]
      );
    });
    if (!saved) return;

    setIncomeLabel("");
    setIncomeAmount("");
    setIncomeCategory("");
    showToast("Revenu ajouté avec succès");
    pendingFocusRef.current = "income";
    refresh();
  }

  async function handleExpenseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = expenseLabel.trim();
    const amount = parseAmount(expenseAmount);
    const date = expenseDate;
    const dateValid = isValidCalendarDate(date);
    setExpenseLabelError(label ? "" : LABEL_REQUIRED);
    setExpenseAmountError(amount === null ? AMOUNT_INVALID : "");
    setExpenseDateError(dateValid ? "" : DATE_REQUIRED);
    if (!label || amount === null || !dateValid) return;

    // The expense is always stored in the month of its date.
    const targetMonth = monthOfDate(date);
    const monthChanged = targetMonth !== month;
    if (monthChanged && !window.confirm(
      `Cette dépense est datée de ${formatMonthLabel(targetMonth)}, mais vous consultez ${formatMonthLabel(month)}.\n\nEnregistrer la dépense dans ${formatMonthLabel(targetMonth)} ?`
    )) {
      return;
    }

    const saved = await runSave("expense", async () => {
      const db = await getDb();
      await db.execute(
        "INSERT INTO expenses (date, month, label, amount, category_id) VALUES (?, ?, ?, ?, ?)",
        [date, targetMonth, label, amount, expenseCategory || null]
      );
    });
    if (!saved) return;

    setExpenseLabel("");
    setExpenseAmount("");
    setExpenseDate("");
    setExpenseCategory("");
    showToast("Dépense ajoutée avec succès");
    pendingFocusRef.current = "expense";
    if (monthChanged) {
      // Switching month reloads the data through useMonthlyBudget.
      setMonth(targetMonth);
    } else {
      refresh();
    }
  }

  async function handleRecurringSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = recurringLabel.trim();
    const amount = parseAmount(recurringAmount);
    const day = parseDayOfMonth(recurringDay);
    setRecurringLabelError(label ? "" : LABEL_REQUIRED);
    setRecurringAmountError(amount === null ? AMOUNT_INVALID : "");
    setRecurringDayError(day === null ? DAY_INVALID : "");
    if (!label || amount === null || day === null) return;

    const saved = await runSave("recurring", async () => {
      const db = await getDb();
      await db.execute(
        "INSERT INTO recurring_expenses (label, amount, category_id, day_of_month, active) VALUES (?, ?, ?, ?, 1)",
        [label, amount, recurringCategory || null, day]
      );
    });
    if (!saved) return;

    setRecurringLabel("");
    setRecurringAmount("");
    setRecurringCategory("");
    setRecurringDay("1");
    showToast("Charge fixe ajoutée avec succès");
    pendingFocusRef.current = "recurring";
    refresh();
  }

  async function addNewGoal() {
    // Reset errors
    setGoalLabelError("");
    setGoalTargetAmountError("");

    // Validation
    let isValid = true;
    if (!goalLabel || goalLabel.trim() === "") {
      setGoalLabelError("Le nom de l'objectif est requis");
      isValid = false;
    }
    const targetAmountValue = goalTargetAmount;
    if (!goalTargetAmount || isNaN(targetAmountValue) || targetAmountValue <= 0) {
      setGoalTargetAmountError("Veuillez entrer un montant cible valide supérieur à 0");
      isValid = false;
    }

    if (!isValid) return;

    try {
      await addGoal({
        label: goalLabel.trim(),
        targetAmount: targetAmountValue,
        currentAmount: 0,
        targetDate: goalTargetDate || undefined,
        categoryId: goalCategoryId
      });

      // Reset form
      setGoalLabel("");
      setGoalTargetAmount(0);
      setGoalTargetDate("");
      setGoalCategoryId(undefined);

      // Focus on first field
      const labelInput = document.getElementById('goal-label-input');
      if (labelInput) {
        labelInput.focus();
      }

      // Show toast
      showToast("Objectif ajouté avec succès");

      // Refresh goals data
      await refreshGoals();
    } catch (err) {
      console.error("Failed to add goal", err);
      alert("Erreur lors de la création de l'objectif: " + err);
    }
  }

  // Delete with undo: the row is hidden at once, the DELETE runs after 5 seconds unless undone
  function deleteWithUndo(id: number, type: DeletableType) {
    const key = deletionQueue.schedule(id, type);
    showToastWithUndo("Opération supprimée", () => undoDeletion(key));
  }

  function undoDeletion(key: number) {
    if (deletionQueue.undo(key)) {
      showToast("Suppression annulée");
    } else {
      showToast("La suppression est déjà en cours et ne peut plus être annulée.");
    }
  }

  // Undo toast rendered by React; its action cancels the queued deletion
  function showToastWithUndo(message: string, undoAction: () => void) {
    showToast(message, "success", { label: "Annuler", run: undoAction }, 5000);
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
            <div>
              <label>Nom de la dette</label>
              <input
                id="debt-label-input"
                style={inputStyle}
                placeholder="Ex: Carte Visa, Prêt étudiant..."
                value={debtLabel}
                onChange={(e) => setDebtLabel(e.target.value)}
              />
              {debtLabelError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{debtLabelError}</p>}
            </div>
            <div>
              <label>Montant dû (€)</label>
              <input
                id="debt-amount-input"
                style={inputStyle}
                placeholder="Ex: 5000,00"
                type="number"
                value={debtAmount}
                onChange={(e) => setDebtAmount(parseFloat(e.target.value) || 0)}
              />
              {debtAmountError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{debtAmountError}</p>}
            </div>
            <div>
              <label>Taux d'intérêt (%)</label>
              <input
                id="debt-interest-input"
                style={inputStyle}
                placeholder="Ex: 4,5"
                type="number"
                value={debtInterest}
                onChange={(e) => setDebtInterest(parseFloat(e.target.value) || undefined)}
              />
              {debtInterestError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{debtInterestError}</p>}
            </div>
            <div>
              <label>Paiement minimum (€)</label>
              <input
                id="debt-minimum-input"
                style={inputStyle}
                placeholder="Ex: 150,00"
                type="number"
                value={debtMinimumPayment}
                onChange={(e) => setDebtMinimumPayment(parseFloat(e.target.value) || undefined)}
              />
              {debtMinimumPaymentError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{debtMinimumPaymentError}</p>}
            </div>
            <div>
              <label>Date d'échéance</label>
              <input
                id="debt-due-date-input"
                style={inputStyle}
                type="date"
                value={debtDueDate}
                onChange={(e) => setDebtDueDate(e.target.value)}
              />
              {debtDueDateError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{debtDueDateError}</p>}
            </div>
            <div>
              <label>Catégorie (optionnel)</label>
              <select
                id="debt-category-input"
                style={inputStyle}
                value={debtCategoryId}
                onChange={(e) => setDebtCategoryId(e.target.value ? parseInt(e.target.value) : undefined)}
              >
                <option value="">Aucune catégorie</option>
                {expenseCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={async () => {
                  // Reset errors
                  setDebtLabelError("");
                  setDebtAmountError("");
                  setDebtInterestError("");
                  setDebtMinimumPaymentError("");
                  setDebtDueDateError("");

                  // Validation
                  let isValid = true;
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

                  if (!label) {
                    setDebtLabelError("Le nom de la dette est requis");
                    isValid = false;
                  }
                  if (isNaN(amount) || amount <= 0) {
                    setDebtAmountError("Veuillez entrer un montant valide supérieur à 0");
                    isValid = false;
                  }

                  if (!isValid) return;

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

                    // Focus on first field
                    if (labelInput) {
                      labelInput.focus();
                    }

                    // Show toast
                    showToast("Dette ajoutée avec succès");

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
        </div>
      </section>

      {/* Graphique */}
      <section style={{ maxWidth: 700, marginBottom: 'var(--spacing-5)' }}>
        <h2>Dépenses par catégorie</h2>
        <Bar
          data={chartData}
          options={{
            onClick: (_event, elements, chart) => {
              if (elements.length > 0) {
                const activePoint = elements[0];
                const label = chart.data.labels?.[activePoint.index];
                if (typeof label !== "string") return;

                // Set the active filter to the clicked category
                setActiveFilterCategory(label);

                // Optional: Show visual feedback that filter is active
                showToast(`Filtre appliqué : ${label}`);
              }
            }
          }}
        />
        {/* Show active filter if any */}
        {activeFilterCategory && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-1)',
            background: 'var(--surface-card)',
            padding: 'var(--spacing-2)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--spacing-3)',
            fontSize: 'var(--text-sm)'
          }}>
            <span>Filtre actif : </span>
            <span style={{
              background: 'var(--color-income)',
              color: 'white',
              padding: 'var(--spacing-1) var(--spacing-2)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 500
            }}>
              {activeFilterCategory}
            </span>
            <button
              onClick={() => {
                setActiveFilterCategory(null);
                showToast("Filtre supprimé");
              }}
              aria-label="Supprimer le filtre"
              title="Supprimer le filtre"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 'var(--spacing-1)',
                fontSize: 'var(--text-xs)'
              }}
            >
              ×
            </button>
          </div>
        )}
      </section>

      {/* Formulaires */}
      <section style={{ display: "flex", gap: 'var(--spacing-5)', flexWrap: "wrap", marginBottom: 'var(--spacing-5)' }}>
        {/* Revenu */}
        <div style={cardStyle}>
          <h3>Ajouter un revenu</h3>
          <form className="form-grid" onSubmit={handleIncomeSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="income-label-input">Libellé</label>
              <input
                id="income-label-input"
                ref={incomeLabelRef}
                className="form-input"
                placeholder="Ex: Salaire, Freelance..."
                value={incomeLabel}
                onChange={(e) => setIncomeLabel(e.target.value)}
                aria-invalid={incomeLabelError ? true : undefined}
                aria-describedby={incomeLabelError ? "income-label-error" : undefined}
              />
              {incomeLabelError && <p id="income-label-error" className="field-error">{incomeLabelError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="income-amount-input">Montant (€)</label>
              <input
                id="income-amount-input"
                className="form-input"
                placeholder="Ex: 1500,00"
                type="number"
                step="0.01"
                min="0"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
                aria-invalid={incomeAmountError ? true : undefined}
                aria-describedby={incomeAmountError ? "income-amount-error" : undefined}
              />
              {incomeAmountError && <p id="income-amount-error" className="field-error">{incomeAmountError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="income-category-input">Catégorie (optionnel)</label>
              <select
                id="income-category-input"
                className="form-input"
                value={incomeCategory}
                onChange={(e) => setIncomeCategory(e.target.value)}
              >
                <option value="">Aucune catégorie</option>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              {formError?.form === "income" && <p role="alert" className="field-error">{formError.message}</p>}
              <button type="submit" className="btn-primary" disabled={savingForm !== null}>
                {savingForm === "income" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>

          <div>
            {/* Income list */}
            {filteredIncomes.length > 0 ? (
              <>
                {filteredIncomes.map((income) => {
                  // Find category name
                  const categoryName = data.categories
                    .find(cat => cat.id === income.category_id)?.name || "Sans catégorie";

                  // Check if this income is pending deletion
                  const isPendingDeletion = pendingDeletions.some(
                    item => item.id === income.id && item.type === 'income'
                  );

                  return isPendingDeletion ? null : (
                      <div key={income.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto 8px 1fr 80px',
                      gap: 'var(--spacing-2)',
                      alignItems: 'center',
                      padding: 'var(--spacing-1) 0',
                      borderBottom: '1px solid var(--surface-border)'
                    }}>
                      {/* Label */}
                      <div style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {income.label}
                      </div>

                      {/* Category dot */}
                      <div style={{
                        width: 8,
                        height: 8,
                        background: categoryName ?
                          (data.categories.find(cat => cat.name === categoryName)?.color || '#888') :
                          '#888',
                        borderRadius: '50%'
                      }}></div>

                      {/* Date */}
                      <div style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-secondary)'
                      }}>
                        {new Date(income.date).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit'
                        })}
                      </div>

                      {/* Amount */}
                      <div style={{
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                        fontWeight: 500
                      }}>
                        {formatEUR(income.amount)}
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => deleteWithUndo(income.id, 'income')}
                        aria-label="Supprimer ce revenu"
                        title="Supprimer ce revenu"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#b91c1c',
                          cursor: 'pointer',
                          padding: 'var(--spacing-1)',
                          fontSize: '1.2rem',
                          lineHeight: 1,
                          borderRadius: 'var(--radius-md)',
                          width: 32,
                          height: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: 'var(--spacing-4)',
                color: 'var(--text-secondary)'
              }}>
                Aucun revenu enregistré pour ce mois
              </div>
            )}
          </div>
        </div>
        <div style={cardStyle}>
          <h3>Ajouter une dépense</h3>
          <form className="form-grid" onSubmit={handleExpenseSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="expense-label-input">Libellé</label>
              <input
                id="expense-label-input"
                ref={expenseLabelRef}
                className="form-input"
                placeholder="Ex: Supermarché, Transport..."
                value={expenseLabel}
                onChange={(e) => setExpenseLabel(e.target.value)}
                aria-invalid={expenseLabelError ? true : undefined}
                aria-describedby={expenseLabelError ? "expense-label-error" : undefined}
              />
              {expenseLabelError && <p id="expense-label-error" className="field-error">{expenseLabelError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="expense-date-input">Date</label>
              <input
                id="expense-date-input"
                className="form-input"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                aria-invalid={expenseDateError ? true : undefined}
                aria-describedby={expenseDateError ? "expense-date-error" : undefined}
              />
              {expenseDateError && <p id="expense-date-error" className="field-error">{expenseDateError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="expense-amount-input">Montant (€)</label>
              <input
                id="expense-amount-input"
                className="form-input"
                placeholder="Ex: 15,50"
                type="number"
                step="0.01"
                min="0"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                aria-invalid={expenseAmountError ? true : undefined}
                aria-describedby={expenseAmountError ? "expense-amount-error" : undefined}
              />
              {expenseAmountError && <p id="expense-amount-error" className="field-error">{expenseAmountError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="expense-category-input">Catégorie (optionnel)</label>
              <select
                id="expense-category-input"
                className="form-input"
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
              >
                <option value="">Aucune catégorie</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              {formError?.form === "expense" && <p role="alert" className="field-error">{formError.message}</p>}
              <button type="submit" className="btn-primary" disabled={savingForm !== null}>
                {savingForm === "expense" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>

          <div>
            {/* Expense list */}
            {filteredExpenses.length > 0 ? (
              <>
                {filteredExpenses.map((expense) => {
                  // Find category name
                  const categoryName = data.categories
                    .find(cat => cat.id === expense.category_id)?.name || "Sans catégorie";

                  // Check if this expense is pending deletion
                  const isPendingDeletion = pendingDeletions.some(
                    item => item.id === expense.id && item.type === 'expense'
                  );

                  return isPendingDeletion ? null : (
                    <div key={expense.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto 8px 1fr 80px',
                      gap: 'var(--spacing-2)',
                      alignItems: 'center',
                      padding: 'var(--spacing-1) 0',
                      borderBottom: '1px solid var(--surface-border)'
                    }}>
                      {/* Label */}
                      <div style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {expense.label}
                      </div>

                      {/* Category dot */}
                      <div style={{
                        width: 8,
                        height: 8,
                        background: categoryName ?
                          (data.categories.find(cat => cat.name === categoryName)?.color || '#888') :
                          '#888',
                        borderRadius: '50%'
                      }}></div>

                      {/* Date */}
                      <div style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-secondary)'
                      }}>
                        {new Date(expense.date).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit'
                        })}
                      </div>

                      {/* Amount */}
                      <div style={{
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                        fontWeight: 500
                      }}>
                        {formatEUR(expense.amount)}
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => deleteWithUndo(expense.id, 'expense')}
                        aria-label="Supprimer cette dépense"
                        title="Supprimer cette dépense"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#b91c1c',
                          cursor: 'pointer',
                          padding: 'var(--spacing-1)',
                          fontSize: '1.2rem',
                          lineHeight: 1,
                          borderRadius: 'var(--radius-md)',
                          width: 32,
                          height: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: 'var(--spacing-4)',
                color: 'var(--text-secondary)'
              }}>
                Aucune dépense enregistrée pour ce mois
              </div>
            )}
          </div>
        </div>

        {/* Dépense récurrente */}
                {/* Dépense récurrente */}
        <div style={cardStyle}>
          <h3>Ajouter une charge fixe</h3>
          <form className="form-grid" onSubmit={handleRecurringSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="recurring-label-input">Libellé</label>
              <input
                id="recurring-label-input"
                ref={recurringLabelRef}
                className="form-input"
                placeholder="Ex: Loyer, Internet, Abonnement..."
                value={recurringLabel}
                onChange={(e) => setRecurringLabel(e.target.value)}
                aria-invalid={recurringLabelError ? true : undefined}
                aria-describedby={recurringLabelError ? "recurring-label-error" : undefined}
              />
              {recurringLabelError && <p id="recurring-label-error" className="field-error">{recurringLabelError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="recurring-amount-input">Montant (€)</label>
              <input
                id="recurring-amount-input"
                className="form-input"
                placeholder="Ex: 50,00"
                type="number"
                step="0.01"
                min="0"
                value={recurringAmount}
                onChange={(e) => setRecurringAmount(e.target.value)}
                aria-invalid={recurringAmountError ? true : undefined}
                aria-describedby={recurringAmountError ? "recurring-amount-error" : undefined}
              />
              {recurringAmountError && <p id="recurring-amount-error" className="field-error">{recurringAmountError}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="recurring-category-input">Catégorie (optionnel)</label>
              <select
                id="recurring-category-input"
                className="form-input"
                value={recurringCategory}
                onChange={(e) => setRecurringCategory(e.target.value)}
              >
                <option value="">Aucune catégorie</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="recurring-day-input">Jour du mois (1 à 31)</label>
              <input
                id="recurring-day-input"
                className="form-input"
                placeholder="Ex: 5"
                type="number"
                inputMode="numeric"
                min="1"
                max="31"
                step="1"
                value={recurringDay}
                onChange={(e) => setRecurringDay(e.target.value)}
                aria-invalid={recurringDayError ? true : undefined}
                aria-describedby={recurringDayError ? "recurring-day-error" : undefined}
              />
              {recurringDayError && <p id="recurring-day-error" className="field-error">{recurringDayError}</p>}
            </div>
            <div className="form-actions">
              {formError?.form === "recurring" && <p role="alert" className="field-error">{formError.message}</p>}
              <button type="submit" className="btn-primary" disabled={savingForm !== null}>
                {savingForm === "recurring" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>

          <div>
            {/* Recurring expense list */}
            {filteredRecurringExpenses.length > 0 ? (
              <>
                {filteredRecurringExpenses.map((recurring) => {
                  // Find category name
                  const categoryName = data.categories
                    .find(cat => cat.id === recurring.category_id)?.name || "Sans catégorie";

                  // Check if this recurring expense is pending deletion
                  const isPendingDeletion = pendingDeletions.some(
                    item => item.id === recurring.id && item.type === 'recurring'
                  );

                  return isPendingDeletion ? null : (
                    <div key={recurring.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto 8px 1fr 80px',
                      gap: 'var(--spacing-2)',
                      alignItems: 'center',
                      padding: 'var(--spacing-1) 0',
                      borderBottom: '1px solid var(--surface-border)'
                    }}>
                      {/* Label */}
                      <div style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {recurring.label}
                      </div>

                      {/* Category dot */}
                      <div style={{
                        width: 8,
                        height: 8,
                        background: categoryName ?
                          (data.categories.find(cat => cat.name === categoryName)?.color || '#888') :
                          '#888',
                        borderRadius: '50%'
                      }}></div>

                      {/* Date (using day of month for recurring) */}
                      <div style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-secondary)'
                      }}>
                        Jour {recurring.day_of_month}
                      </div>

                      {/* Amount */}
                      <div style={{
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                        fontWeight: 500
                      }}>
                        {formatEUR(recurring.amount)}
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => deleteWithUndo(recurring.id, 'recurring')}
                        aria-label="Supprimer cette charge fixe"
                        title="Supprimer cette charge fixe"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#b91c1c',
                          cursor: 'pointer',
                          padding: 'var(--spacing-1)',
                          fontSize: '1.2rem',
                          lineHeight: 1,
                          borderRadius: 'var(--radius-md)',
                          width: 32,
                          height: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: 'var(--spacing-4)',
                color: 'var(--text-secondary)'
              }}>
                Aucune charge fixe enregistrée pour ce mois
              </div>
            )}
          </div>
        </div>

        {/* Objectif d'épargne */}
        <div style={cardStyle}>
          <h3>Nouvel objectif d'épargne</h3>
          <div style={{ display: "grid", gap: 'var(--spacing-2)', gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            <div>
              <label>Nom de l'objectif</label>
              <input
                id="goal-label-input"
                style={inputStyle}
                placeholder="Ex: Vacances, Nouvelle voiture..."
                value={goalLabel}
                onChange={(e) => setGoalLabel(e.target.value)}
              />
              {goalLabelError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{goalLabelError}</p>}
            </div>
            <div>
              <label>Montant cible (€)</label>
              <input
                id="goal-target-amount-input"
                style={inputStyle}
                placeholder="Ex: 1000,00"
                type="number"
                value={goalTargetAmount}
                onChange={(e) => setGoalTargetAmount(parseFloat(e.target.value) || 0)}
              />
              {goalTargetAmountError && <p style={{ color: 'var(--color-expense)', fontSize: 'var(--text-xs)', marginTop: 'var(--spacing-1)' }}>{goalTargetAmountError}</p>}
            </div>
            <div>
              <label>Date cible (optionnel)</label>
              <input
                id="goal-target-date-input"
                style={inputStyle}
                type="date"
                value={goalTargetDate}
                onChange={(e) => setGoalTargetDate(e.target.value)}
              />
            </div>
            <div>
              <label>Catégorie (optionnel)</label>
              <select
                id="goal-category-input"
                style={inputStyle}
                value={goalCategoryId}
                onChange={(e) => setGoalCategoryId(e.target.value ? parseInt(e.target.value) : undefined)}
              >
                <option value="">Aucune catégorie</option>
                {expenseCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button style={btnStyle} onClick={addNewGoal}>
                Ajouter l'objectif
              </button>
            </div>
          </div>
        </div>
      </section>
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}