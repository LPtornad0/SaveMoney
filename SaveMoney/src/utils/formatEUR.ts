/**
 * Utility function to format numbers as Euro currency in French locale
 * Uses Intl.NumberFormat for proper localization
 */

// Create a reusable formatter instance
const eurFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

/**
 * Format a number as Euro currency
 * @param amount - The amount to format (can be number or string that converts to number)
 * @returns Formatted string like "1 234,56 €"
 */
export function formatEUR(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  // Handle invalid numbers
  if (isNaN(num)) {
    return '0,00 €';
  }

  return eurFormatter.format(num);
}

/**
 * Format a number as Euro currency without the currency symbol
 * @param amount - The amount to format
 * @returns Formatted string like "1 234,56" (without € symbol)
 */
export function formatEURWithoutSymbol(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(num)) {
    return '0,00';
  }

  return eurFormatter.format(num).replace('€', '').trim();
}

export default { formatEUR, formatEURWithoutSymbol };