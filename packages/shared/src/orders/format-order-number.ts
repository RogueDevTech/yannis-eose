/**
 * Format sequential order_number into a human-friendly reference.
 *
 * Examples:
 *   10042 → "YNS-10042"
 *   9853  → "YNS-09853"
 *   10042 for a company whose order_prefix is "ZAR" → "ZAR-10042"
 *
 * The prefix comes from `branch_groups.order_prefix` (migration 0343), so the
 * company an order belongs to is stored data — queryable and exportable — not
 * something reconstructed at render time. Only `order_number` is stored on the
 * order itself, which is why order identity and the search parser both key off
 * the number and never the prefix.
 */

/** Fallback when a company's prefix is unavailable — the original scheme. */
export const DEFAULT_ORDER_PREFIX = 'YNS';

export function formatOrderNumber(
  orderNumber: number | null | undefined,
  /**
   * The company's `order_prefix`. Omit to fall back to "YNS" — callers that
   * have not been given the company (legacy call sites, payloads without a
   * branch) keep the previous behaviour rather than rendering a wrong company.
   */
  orderPrefix?: string | null,
): string {
  if (orderNumber == null) return '—';
  const prefix = (orderPrefix ?? '').trim() || DEFAULT_ORDER_PREFIX;
  return `${prefix}-${String(orderNumber).padStart(5, '0')}`;
}
