/**
 * Format sequential order_number into a human-friendly reference.
 *
 * Examples:
 *   10042 → "YNS-10042"
 *   9853  → "YNS-09853"
 *
 * The prefix is cosmetic — only order_number is stored in the DB.
 */
export function formatOrderNumber(orderNumber: number | null | undefined): string {
  if (orderNumber == null) return '—';
  return `YNS-${String(orderNumber).padStart(5, '0')}`;
}
