/**
 * Rules for editing an operation in place. No React and no database here: the
 * Dashboard calls these functions, and scripts/verify-inline-edit.mjs checks them.
 * Dates and months are never edited, so they are not part of this module.
 */
import { isSavingsCategory } from "./computeSummary";
import { matchesCategoryFilter, type CategoryFilter, type ChartCategory } from "./chartRows";
import { AMOUNT_INVALID, DAY_INVALID, LABEL_REQUIRED, parseAmount, parseDayOfMonth } from "./formValidation";

export type EditKind = "income" | "expense" | "recurring";

// Row as loaded from the database (operations and recurring expenses share these fields)
export interface EditRowSource {
  id: number;
  label: string;
  amount: number;
  category_id: number | null;
  day_of_month?: number | null;
}

// Values the row had when editing started; a draft is compared against them
export interface EditBaseline {
  label: string;
  amount: number;
  categoryId: number | null;
  day: number | null;
}

// What the form holds: every field is text, as typed
export interface EditDraft {
  label: string;
  amount: string;
  categoryId: string;
  day: string;
}

export interface EditValues {
  label: string;
  amount: number;
  categoryId: number | null;
  day: number | null;
}

export interface EditErrors {
  label?: string;
  amount?: string;
  day?: string;
}

export const EDIT_SAVE_ERROR = "L'enregistrement a échoué. Vos modifications sont conservées.";
export const EDIT_DISCARD_MESSAGE = "Abandonner les modifications non enregistrées de cette opération ?";

// Same key as the operations list: "income-4", "expense-7", "recurring-2"
export function editKey(kind: EditKind, id: number): string {
  return `${kind}-${id}`;
}

export function editButtonId(key: string): string {
  return `edit-${key}`;
}

export function baselineFromRow(kind: EditKind, row: EditRowSource): EditBaseline {
  return {
    label: row.label,
    amount: row.amount,
    categoryId: row.category_id,
    day: kind === "recurring" ? (row.day_of_month ?? null) : null,
  };
}

export function draftFromBaseline(baseline: EditBaseline): EditDraft {
  return {
    label: baseline.label,
    amount: String(baseline.amount),
    categoryId: baseline.categoryId === null ? "" : String(baseline.categoryId),
    day: baseline.day === null ? "" : String(baseline.day),
  };
}

// Compared by meaning, not by text: "10" and "10.00" are the same amount.
// NaN stands for an unreadable value, which never equals the baseline, so it counts as a change.
function normalizeAmount(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function normalizeCategory(raw: string): number | null {
  return raw === "" ? null : Number(raw);
}

// "05" and "5" are the same day. An empty day is null; anything that is not a whole number is NaN.
function normalizeDay(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

// True when the draft differs from the baseline in a way that would be saved.
export function isDraftChanged(kind: EditKind, baseline: EditBaseline, draft: EditDraft): boolean {
  if (draft.label.trim() !== baseline.label.trim()) return true;
  if (!(normalizeAmount(draft.amount) === baseline.amount)) return true;
  if (normalizeCategory(draft.categoryId) !== baseline.categoryId) return true;
  if (kind === "recurring" && !(normalizeDay(draft.day) === baseline.day)) return true;
  return false;
}

// Same rules as the add forms: a label, an amount above 0, and for recurring expenses a day from 1 to 31.
export function validateDraft(
  kind: EditKind,
  draft: EditDraft
): { values: EditValues } | { errors: EditErrors } {
  const errors: EditErrors = {};
  const label = draft.label.trim();
  const amount = parseAmount(draft.amount);
  const day = kind === "recurring" ? parseDayOfMonth(draft.day) : null;
  if (!label) errors.label = LABEL_REQUIRED;
  if (amount === null) errors.amount = AMOUNT_INVALID;
  if (kind === "recurring" && day === null) errors.day = DAY_INVALID;
  if (errors.label || errors.amount || errors.day) return { errors };
  return { values: { label, amount: amount as number, categoryId: normalizeCategory(draft.categoryId), day } };
}

// Only label, amount, category (and day for recurring expenses). The date and the month are not written.
const UPDATE_SQL: Record<EditKind, string> = {
  income: "UPDATE incomes SET label = ?, amount = ?, category_id = ? WHERE id = ?",
  expense: "UPDATE expenses SET label = ?, amount = ?, category_id = ? WHERE id = ?",
  recurring: "UPDATE recurring_expenses SET label = ?, amount = ?, category_id = ?, day_of_month = ? WHERE id = ?",
};

export function buildUpdate(kind: EditKind, id: number, values: EditValues): { sql: string; params: unknown[] } {
  const common = [values.label, values.amount, values.categoryId];
  if (kind === "recurring") {
    return { sql: UPDATE_SQL.recurring, params: [...common, values.day, id] };
  }
  return { sql: UPDATE_SQL[kind], params: [...common, id] };
}

export type SubmitOutcome = "saved" | "failed";

// Sends one UPDATE. "failed" means the write did not happen; the caller keeps the draft.
// A reload after "saved" is the caller's business and cannot turn this into "failed".
export async function submitEdit(
  kind: EditKind,
  id: number,
  values: EditValues,
  execute: (sql: string, params: unknown[]) => Promise<unknown>,
  onFailure?: (error: unknown) => void
): Promise<SubmitOutcome> {
  const { sql, params } = buildUpdate(kind, id, values);
  try {
    await execute(sql, params);
    return "saved";
  } catch (error) {
    onFailure?.(error);
    return "failed";
  }
}

export type TransitionDecision = "proceed" | "blocked";

// Decides whether a transition that would drop the edit may go ahead.
// A save in progress always blocks it. An unchanged draft goes ahead without asking.
// A changed draft asks once; a refusal keeps the draft and the current state.
export function requestEditTransition(
  state: { dirty: boolean; saving: boolean },
  confirmDiscard: () => boolean
): TransitionDecision {
  if (state.saving) return "blocked";
  if (!state.dirty) return "proceed";
  return confirmDiscard() ? "proceed" : "blocked";
}

// True when the saved category leaves the active filter. No filter means nothing leaves it.
export function outsideFilter(
  categoryId: number | null,
  filter: CategoryFilter | null,
  categories: ChartCategory[]
): boolean {
  if (filter === null) return false;
  return !matchesCategoryFilter(categoryId, filter, categories);
}

// True when an expense or a recurring expense is moved into a savings category: it then leaves the chart.
export function movesToSavings(kind: EditKind, categoryId: number | null, categories: ChartCategory[]): boolean {
  if (kind === "income" || categoryId === null) return false;
  const category = categories.find((cat) => cat.id === categoryId);
  return category !== undefined && isSavingsCategory(category.name);
}

export function editSuccessMessage(outside: boolean, toSavings: boolean): string {
  if (outside) return "Modification enregistrée. L'opération ne correspond plus au filtre actif et n'apparaît plus dans cette liste.";
  if (toSavings) return "Modification enregistrée. Classée en épargne, l'opération sort des dépenses et du graphique.";
  return "Opération modifiée avec succès";
}

// One save at a time. begin() returns false while a save is running, so a second submit does nothing.
// The Dashboard keeps one guard per component, and runGuarded is the only place that starts a save.
export interface SaveGuard {
  isSaving: () => boolean;
  begin: () => boolean;
  end: () => void;
}

export function createSaveGuard(): SaveGuard {
  let saving = false;
  return {
    isSaving: () => saving,
    begin: () => {
      if (saving) return false;
      saving = true;
      return true;
    },
    end: () => {
      saving = false;
    },
  };
}

// Runs work under the guard. Returns "skipped" without calling work when a save is already running.
export async function runGuarded<T>(
  guard: SaveGuard,
  work: () => Promise<T>
): Promise<T | "skipped"> {
  if (!guard.begin()) return "skipped";
  try {
    return await work();
  } finally {
    guard.end();
  }
}
