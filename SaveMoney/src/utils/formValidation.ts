/**
 * Pure validation rules for the add forms. No side effects, so they can be
 * checked without the Tauri runtime (see scripts/verify-form-rules.mjs).
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Returns the amount as a strictly positive finite number, or null when invalid.
export function parseAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// Returns a whole day between 1 and 31, or null. Decimals and signs are rejected.
export function parseDayOfMonth(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
}

// True only for an existing calendar date in YYYY-MM-DD form (rejects 2026-02-30).
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// The month an expense is stored under is always derived from its date.
export function monthOfDate(value: string): string {
  return value.slice(0, 7);
}
