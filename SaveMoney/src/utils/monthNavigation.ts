// Moves a month by whole months, keeping the YYYY-MM format used everywhere in the app.
// Returns null for anything that is not a valid YYYY-MM value.

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function addMonths(month: string, delta: number): string | null {
  if (!MONTH_FORMAT.test(month) || !Number.isInteger(delta)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  // Months counted from year 0, so December + 1 rolls over to January of the next year
  const index = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12 + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}
