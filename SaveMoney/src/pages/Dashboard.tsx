import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { buildChartRows, filterByCategory, isSameFilter, type CategoryFilter } from "../utils/chartRows";
import { buildOperations, formatShortDate, sortRecurring } from "../utils/operations";
import { getDb } from "../db/client";
import { useMonthlyBudget } from "../hooks/useMonthlyBudget";
import { useGoals } from "../hooks/useGoals";
import { useDebts } from "../hooks/useDebts";
import { formatEUR } from "../utils/formatEUR";
import {
  AMOUNT_INVALID,
  DAY_INVALID,
  LABEL_REQUIRED,
  isValidCalendarDate,
  monthOfDate,
  parseAmount,
  parseDayOfMonth,
} from "../utils/formValidation";
import { DeferredDeletionQueue, type DeletableType, type PendingDeletion } from "../utils/deferredDeletions";
import { createCloseGate, createEditAwareClose } from "../utils/closeGate";
import {
  EDIT_DISCARD_MESSAGE,
  EDIT_SAVE_ERROR,
  baselineFromRow,
  draftFromBaseline,
  editButtonId,
  editKey,
  editSuccessMessage,
  isDraftChanged,
  movesToSavings,
  outsideFilter,
  requestEditTransition,
  createSaveGuard,
  runGuarded,
  submitEdit,
  validateDraft,
  type EditBaseline,
  type EditDraft,
  type EditErrors,
  type EditKind,
  type EditRowSource,
  type TransitionDecision,
} from "../utils/inlineEdit";
import { categoryDotColor } from "../utils/categoryColor";
import { OperationEditForm, type CategoryOption } from "../components/OperationEditForm";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// Canvas cannot read CSS variables, so the dark theme colors are set once here
ChartJS.defaults.color = "#A1A1AA";
ChartJS.defaults.borderColor = "#2A2A2D";

// Prints each bar's amount just above it
const barValueLabels: Plugin<"bar"> = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      chart.getDatasetMeta(datasetIndex).data.forEach((bar, index) => {
        ctx.fillText(formatEUR(Number(dataset.data[index])), bar.x, bar.y - 4);
      });
    });
    ctx.restore();
  },
};
ChartJS.register(barValueLabels);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-08"
}

type FormKind = "income" | "expense" | "recurring";

const DATE_REQUIRED = "Choisissez une date valide";
const SAVE_ERROR_MESSAGE = "L'enregistrement a échoué. Vos saisies sont conservées.";
const DELETE_FAILED_MESSAGE = "La suppression a échoué. La ligne est restée enregistrée.";
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const MONTH_CHANGE_FAILED_MESSAGE =
  "Changement de mois annulé : une suppression n'a pas pu être finalisée. Vous restez sur ce mois.";
const UNDO_FINALIZING_MESSAGE = "Finalisation de la suppression…";
const EDIT_SAVING_CLOSE_MESSAGE = "Enregistrement en cours : la fermeture est annulée. Réessayez dans un instant.";
const OPERATIONS_HEADING_ID = "ops-operations-heading";
const CHARGES_HEADING_ID = "ops-recurring-heading";
const MONTH_CHANGE_BLOCKED_REASON = "le changement de mois est bloqué pour le moment";

// The row being edited. Only one at a time; the draft is kept until it is saved or dropped.
interface EditingRow {
  kind: EditKind;
  id: number;
  key: string;
  baseline: EditBaseline;
  draft: EditDraft;
  errors: EditErrors;
  saveError: string | null;
}

// Small colored dot; a neutral ring when the entry has no category
function CategoryDot({ color }: { color: string | null }) {
  return (
    <span
      className={color === null ? "cat-dot cat-dot-none" : "cat-dot"}
      style={color === null ? undefined : { background: color }}
      aria-hidden="true"
    />
  );
}

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
  action?: { label: string; run: () => void; disabled?: boolean };
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
                disabled={action.disabled}
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
  // Active filter from a chart click: null (no filter), a category, or entries without a category
  const [activeFilter, setActiveFilter] = useState<CategoryFilter | null>(null);

  // Inline edit: one row at a time. The ref blocks a second save before React re-renders.
  const [editing, setEditing] = useState<EditingRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editGuard] = useState(createSaveGuard);
  // Read by the close listener, which is mounted once: updated after each render
  const editDirty = editing !== null && isDraftChanged(editing.kind, editing.baseline, editing.draft);
  const editGuardRef = useRef({ dirty: false });
  useEffect(() => {
    editGuardRef.current = { dirty: editDirty };
  });
  // Focus target after a save or a cancel: the row's edit button, or the list heading if the row is gone
  const pendingEditFocusRef = useRef<string | null>(null);

  // Chart rows: expense categories without savings, largest amount first, empty ones hidden
  const chartRows = useMemo(() => (data ? buildChartRows(data) : []), [data]);

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
  const undoToastIdsRef = useRef(new Set<number>());

  // Set while a month change or a window close finalizes the pending deletions
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);

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

  // Focus after a save or a cancel. It waits for the reloaded list, so the target exists.
  useEffect(() => {
    const key = pendingEditFocusRef.current;
    if (key === null || loading || !data) return;
    const fallbackId = key.startsWith("recurring-") ? CHARGES_HEADING_ID : OPERATIONS_HEADING_ID;
    const target = document.getElementById(editButtonId(key)) ?? document.getElementById(fallbackId);
    target?.focus();
    pendingEditFocusRef.current = null;
  }, [editing, loading, data]);

  // The edited row can only disappear through a reload. Its draft is then dropped with a message, not kept silently.
  useEffect(() => {
    if (!editing || loading || !data) return;
    const rows =
      editing.kind === "income" ? data.incomes
      : editing.kind === "expense" ? data.expenses
      : data.recurringExpenses;
    if (!rows.some((row) => row.id === editing.id)) {
      setEditing(null);
      showToast("L'opération n'est plus disponible. La modification est annulée.", "error");
    }
  }, [editing, loading, data]);

  const dismissToast = (id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    undoToastIdsRef.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: ToastTone = "success", action?: ToastItem["action"], durationMs = 3000) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    if (action) undoToastIdsRef.current.add(id);
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
        // During a month change the caller reloads once, so no intermediate reload here
        onSuccess: () => {
          if (!navigatingRef.current) refreshRef.current();
        },
        onFailure: () => showToast(DELETE_FAILED_MESSAGE, "error"),
      })
  );

  // Closing the window finalizes the pending deletions first. Tauri listener: the decision lives in closeGate.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const gate = createCloseGate({
      hasPending: () => deletionQueue.hasPending(),
      flush: async () => {
        navigatingRef.current = true;
        setNavigating(true);
        try {
          return { failed: await finalizePendingDeletions() };
        } finally {
          navigatingRef.current = false;
          setNavigating(false);
        }
      },
      close: () => getCurrentWindow().close(),
      onBlocked: (message) => showToast(message, "error"),
    });
    // The unsaved edit is checked first; only an accepted close reaches the gate, which alone may finalize deletions.
    // Read through refs and guard objects: this listener is mounted once.
    const handleCloseRequest = createEditAwareClose({
      isSaving: () => editGuard.isSaving(),
      isDirty: () => editGuardRef.current.dirty,
      confirmDiscard: () => window.confirm(EDIT_DISCARD_MESSAGE),
      onSaving: () => showToast(EDIT_SAVING_CLOSE_MESSAGE, "error"),
      discardEdit: () => setEditing(null),
      gate,
    });
    getCurrentWindow()
      .onCloseRequested(handleCloseRequest)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => console.error("Failed to listen for window close", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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

  // Revenues only offer income categories, expenses and recurring expenses offer expense categories (Épargne included).
  // The stored category stays selectable even if it is not of the usual type, so saving does not silently change it.
  const categoryOptionsFor = (kind: EditKind, storedId: number | null): CategoryOption[] => {
    const usual = kind === "income" ? incomeCategories : expenseCategories;
    if (storedId === null || usual.some((cat) => cat.id === storedId)) return usual;
    const stored = data.categories.find((cat) => cat.id === storedId);
    return [...usual, { id: storedId, name: stored?.name ?? "Catégorie introuvable" }];
  };

  // Filter data based on active category filter
  const filteredIncomes = filterByCategory(data.incomes, activeFilter, data.categories);
  const filteredExpenses = filterByCategory(data.expenses, activeFilter, data.categories);
  const filteredRecurringExpenses = filterByCategory(data.recurringExpenses, activeFilter, data.categories);

  // Entries whose deletion is pending are hidden at once, as before
  const isPendingDeletion = (id: number, type: DeletableType) =>
    pendingDeletions.some((item) => item.id === id && item.type === type);
  const operations = buildOperations(filteredIncomes, filteredExpenses).filter(
    (op) => !isPendingDeletion(op.id, op.kind)
  );
  const recurringRows = sortRecurring(filteredRecurringExpenses).filter(
    (rec) => !isPendingDeletion(rec.id, "recurring")
  );

  // Runs one save at a time; a second submit while saving is ignored.
  async function runSave(form: FormKind, save: () => Promise<void>): Promise<boolean> {
    if (savingRef.current || navigatingRef.current) return false;
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
    if (!monthChanged) {
      showToast("Dépense ajoutée avec succès");
      pendingFocusRef.current = "expense";
      refresh();
      return;
    }

    // The expense is saved at this point: whatever the month change does, it must not be submitted again.
    const status = await requestMonthChange(targetMonth);
    if (status === "changed") {
      showToast("Dépense ajoutée avec succès");
      pendingFocusRef.current = "expense";
      return;
    }
    const reason =
      status === "failed"
        ? "une suppression en attente n'a pas pu être finalisée"
        : MONTH_CHANGE_BLOCKED_REASON;
    showToast(
      `La dépense est enregistrée dans ${formatMonthLabel(targetMonth)}. Vous restez sur ${formatMonthLabel(month)} : ${reason}. Ne la soumettez pas à nouveau.`,
      "error"
    );
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

  // Undo actions cannot be used once finalization has started: they show it instead of disappearing silently
  function disableUndoToasts() {
    const ids = undoToastIdsRef.current;
    setToasts((prev) =>
      prev.map((toast) =>
        ids.has(toast.id) && toast.action
          ? { ...toast, message: UNDO_FINALIZING_MESSAGE, action: { ...toast.action, disabled: true } }
          : toast
      )
    );
  }

  function dismissUndoToasts() {
    for (const id of Array.from(undoToastIdsRef.current)) dismissToast(id);
  }

  // Runs every pending deletion; returns how many failed. Failed rows are visible again, so the list is reloaded.
  async function finalizePendingDeletions(): Promise<number> {
    disableUndoToasts();
    const outcomes = await deletionQueue.flushAll();
    dismissUndoToasts();
    const failed = outcomes.filter((outcome) => !outcome.ok).length;
    if (failed > 0) refreshRef.current();
    return failed;
  }

  // Single entry point for every month change (selector and expense saved in another month)
  async function requestMonthChange(target: string): Promise<"changed" | "unchanged" | "blocked" | "failed"> {
    if (target === month || !MONTH_PATTERN.test(target)) return "unchanged";
    if (navigatingRef.current || editGuard.isSaving()) return "blocked";
    // The edit check comes before any finalization: a refused change leaves the pending deletions alone
    if (editTransition() === "blocked") return "blocked";
    setEditing(null);
    navigatingRef.current = true;
    setNavigating(true);
    try {
      const failed = await finalizePendingDeletions();
      if (failed > 0) return "failed";
      setMonth(target);
      // The filter belongs to the month shown; it is cleared only when the month really changed
      setActiveFilter(null);
      return "changed";
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }

  async function handleMonthInput(target: string) {
    const status = await requestMonthChange(target);
    if (status === "failed") showToast(MONTH_CHANGE_FAILED_MESSAGE, "error");
  }

  // Delete with undo: the row is hidden at once, the DELETE runs after 5 seconds unless undone
  function deleteWithUndo(id: number, type: DeletableType) {
    if (navigatingRef.current || editGuard.isSaving()) return;
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

  // Every transition that would drop an unsaved draft goes through here (a save in progress blocks it)
  function editTransition(): TransitionDecision {
    return requestEditTransition(
      { dirty: editGuardRef.current.dirty, saving: editGuard.isSaving() },
      () => window.confirm(EDIT_DISCARD_MESSAGE)
    );
  }

  // Filter changes (chart click, chip, empty state) end the edit, as they may hide the edited row
  function changeFilter(next: CategoryFilter | null, message?: string) {
    if (editTransition() === "blocked") return;
    setEditing(null);
    setActiveFilter(next);
    if (message) showToast(message);
  }

  function beginEdit(kind: EditKind, row: EditRowSource) {
    const key = editKey(kind, row.id);
    if (editing?.key === key) return;
    if (navigatingRef.current || editGuard.isSaving()) return;
    if (editTransition() === "blocked") return;
    const baseline = baselineFromRow(kind, row);
    setEditing({
      kind,
      id: row.id,
      key,
      baseline,
      draft: draftFromBaseline(baseline),
      errors: {},
      saveError: null,
    });
  }

  function cancelEdit() {
    if (!editing) return;
    if (editTransition() === "blocked") return;
    pendingEditFocusRef.current = editing.key;
    setEditing(null);
  }

  function changeEditDraft(field: keyof EditDraft, value: string) {
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, [field]: value } } : prev));
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !data || editGuard.isSaving()) return;
    const { kind, id, key } = editing;
    const checked = validateDraft(kind, editing.draft);
    if ("errors" in checked) {
      setEditing((prev) => (prev ? { ...prev, errors: checked.errors, saveError: null } : prev));
      return;
    }
    const values = checked.values;

    // runGuarded refuses a second run while this one is in progress; the first run alone changes the state
    const outcome = await runGuarded(editGuard, async () => {
      setEditSaving(true);
      setEditing((prev) => (prev ? { ...prev, errors: {}, saveError: null } : prev));
      return submitEdit(
        kind,
        id,
        values,
        async (sql, params) => {
          const db = await getDb();
          await db.execute(sql, params);
        },
        (error) => console.error(`Failed to update ${kind}`, error)
      );
    });
    if (outcome === "skipped") return;
    setEditSaving(false);

    if (outcome === "failed") {
      // Nothing was written: the draft stays as typed, and the error is shown on its row
      setEditing((prev) => (prev ? { ...prev, saveError: EDIT_SAVE_ERROR } : prev));
      return;
    }

    // The update is saved. The edit ends before the reload, so the same change is never submitted again.
    const leavesFilter = outsideFilter(values.categoryId, activeFilter, data.categories);
    const toSavings = movesToSavings(kind, values.categoryId, data.categories);
    pendingEditFocusRef.current = key;
    setEditing(null);
    showToast(editSuccessMessage(leavesFilter, toSavings));
    refresh();
  }

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

  const chartData = {
    labels: chartRows.map((row) => row.label),
    datasets: [
      {
        label: "Dépenses et charges fixes (€)",
        data: chartRows.map((row) => row.total),
        backgroundColor: "#EF4444",
        borderRadius: 4,
      },
    ],
  };

  const chartOptions: ChartOptions<"bar"> = {
    // The chart fills its responsive container instead of a fixed size
    maintainAspectRatio: false,
    layout: { padding: { top: 24 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1A1A1C",
        borderColor: "#2A2A2D",
        borderWidth: 1,
        titleColor: "#FFFFFF",
        bodyColor: "#FFFFFF",
        callbacks: {
          label: (context) => formatEUR(Number(context.parsed.y)),
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
    onClick: (_event, elements) => {
      if (elements.length === 0) return;
      // Each row carries its own filter, so the sorted bar and the filtered entries always match
      const row = chartRows[elements[0].index];
      if (!row) return;
      const isSame = isSameFilter(activeFilter, row.filter);
      changeFilter(isSame ? null : row.filter, isSame ? "Filtre supprimé" : `Filtre appliqué : ${row.label}`);
    },
  };

  const activeFilterLabel =
    activeFilter === null
      ? ""
      : activeFilter.kind === "uncategorized"
        ? "Sans catégorie"
        : data.categories.find((cat) => cat.id === activeFilter.categoryId)?.name ?? "Catégorie";

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface-card)',
    padding: 'var(--spacing-3)',
    borderRadius: "12px",
    flex: 1,
    minWidth: 160,
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
    <main className="app-container" style={{
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
          disabled={navigating}
          onChange={(e) => void handleMonthInput(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Blocs résumé */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-5)' }}>
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

      <div className="dashboard-main">
      {/* Graphique */}
      <section className="chart-card">
        <h2>Dépenses et charges fixes par catégorie — hors épargne</h2>
        {chartRows.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            Aucune dépense ni charge fixe catégorisée pour ce mois.
          </p>
        ) : (
          <div className="chart-box">
            <Bar data={chartData} options={chartOptions} />
          </div>
        )}
        {/* Show active filter if any */}
        {activeFilter !== null && (
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
              {activeFilterLabel}
            </span>
            <button
              onClick={() => changeFilter(null, "Filtre supprimé")}
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
        <div className="ops-pair">
          <section className="ops-card">
            <h2 id={OPERATIONS_HEADING_ID} tabIndex={-1}>Opérations du mois</h2>
            {operations.length === 0 ? (
              <div className="ops-empty-state">
                <p className="ops-empty">
                  {activeFilter === null
                    ? "Aucune opération enregistrée pour ce mois."
                    : "Aucune opération pour ce filtre ce mois-ci."}
                </p>
                {activeFilter !== null && (
                  <button type="button" className="btn-ghost" onClick={() => changeFilter(null, "Filtre supprimé")}>
                    Retirer le filtre
                  </button>
                )}
              </div>
            ) : (
              <div className="ops-scroll" role="region" aria-label="Liste des revenus et dépenses" tabIndex={0}>
                <ul className="ops-list">
                  {operations.map((op) => {
                    const categoryName = data.categories.find((cat) => cat.id === op.category_id)?.name ?? "Sans catégorie";
                    const kindLabel = op.kind === "income" ? "Revenu" : "Dépense";
                    const editor = editing?.key === op.key ? editing : null;
                    return (
                      <li key={op.key} className={editor ? "ops-row ops-row-editing" : "ops-row"}>
                        {editor ? (
                          <OperationEditForm
                            idPrefix={`edit-${op.key}`}
                            kind={editor.kind}
                            draft={editor.draft}
                            errors={editor.errors}
                            saveError={editor.saveError}
                            saving={editSaving}
                            categories={categoryOptionsFor(editor.kind, editor.baseline.categoryId)}
                            onChange={changeEditDraft}
                            onSubmit={handleEditSubmit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          <>
                            <span className={`ops-kind ops-kind-${op.kind}`}>{kindLabel}</span>
                            <span className="ops-label">{op.label}</span>
                            <span className="ops-meta">
                              <CategoryDot color={categoryDotColor(op.category_id, data.categories)} />
                              {categoryName} · {formatShortDate(op.date)}
                            </span>
                            <span className="ops-amount">{formatEUR(op.amount)}</span>
                            <span className="ops-actions">
                              <button
                                id={editButtonId(op.key)}
                                type="button"
                                className="ops-edit"
                                onClick={() => beginEdit(op.kind, op)}
                                disabled={navigating || editSaving}
                                aria-label={`Modifier ${kindLabel.toLowerCase()} : ${op.label}`}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="ops-delete"
                                onClick={() => deleteWithUndo(op.id, op.kind)}
                                disabled={navigating || editSaving}
                                aria-label={`Supprimer ${kindLabel.toLowerCase()} : ${op.label}`}
                                title="Supprimer"
                              >
                                ×
                              </button>
                            </span>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="ops-card">
            <h2 id={CHARGES_HEADING_ID} tabIndex={-1}>Charges fixes actives</h2>
            {recurringRows.length === 0 ? (
              <div className="ops-empty-state">
                <p className="ops-empty">
                  {activeFilter === null
                    ? "Aucune charge fixe active."
                    : "Aucune charge fixe active pour ce filtre."}
                </p>
                {activeFilter !== null && (
                  <button type="button" className="btn-ghost" onClick={() => changeFilter(null, "Filtre supprimé")}>
                    Retirer le filtre
                  </button>
                )}
              </div>
            ) : (
              <div className="ops-scroll" role="region" aria-label="Liste des charges fixes actives" tabIndex={0}>
                <ul className="ops-list">
                  {recurringRows.map((rec) => {
                    const categoryName = data.categories.find((cat) => cat.id === rec.category_id)?.name ?? "Sans catégorie";
                    const key = editKey("recurring", rec.id);
                    const editor = editing?.key === key ? editing : null;
                    return (
                      <li key={`recurring-${rec.id}`} className={editor ? "ops-row ops-row-editing" : "ops-row"}>
                        {editor ? (
                          <OperationEditForm
                            idPrefix={`edit-${key}`}
                            kind={editor.kind}
                            draft={editor.draft}
                            errors={editor.errors}
                            saveError={editor.saveError}
                            saving={editSaving}
                            categories={categoryOptionsFor(editor.kind, editor.baseline.categoryId)}
                            onChange={changeEditDraft}
                            onSubmit={handleEditSubmit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          <>
                            <span className="ops-kind ops-kind-recurring">Charge fixe</span>
                            <span className="ops-label">{rec.label}</span>
                            <span className="ops-meta">
                              <CategoryDot color={categoryDotColor(rec.category_id, data.categories)} />
                              {categoryName} · {rec.day_of_month !== null ? `le ${rec.day_of_month} du mois` : "jour non défini"}
                            </span>
                            <span className="ops-amount">{formatEUR(rec.amount)}</span>
                            <span className="ops-actions">
                              <button
                                id={editButtonId(key)}
                                type="button"
                                className="ops-edit"
                                onClick={() => beginEdit("recurring", rec)}
                                disabled={navigating || editSaving}
                                aria-label={`Modifier la charge fixe : ${rec.label}`}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="ops-delete"
                                onClick={() => deleteWithUndo(rec.id, "recurring")}
                                disabled={navigating || editSaving}
                                aria-label={`Supprimer la charge fixe : ${rec.label}`}
                                title="Supprimer"
                              >
                                ×
                              </button>
                            </span>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>

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

      {/* Formulaires d'ajout */}
      <section className="add-forms">
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
              <button type="submit" className="btn-primary" disabled={savingForm !== null || navigating || editSaving}>
                {savingForm === "income" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>
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
              <button type="submit" className="btn-primary" disabled={savingForm !== null || navigating || editSaving}>
                {savingForm === "expense" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>
        </div>
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
              <button type="submit" className="btn-primary" disabled={savingForm !== null || navigating || editSaving}>
                {savingForm === "recurring" ? "Enregistrement…" : "Ajouter"}
              </button>
            </div>
          </form>
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