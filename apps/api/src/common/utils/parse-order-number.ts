/**
 * Parse a searched order reference into its numeric order number.
 *
 * Accepts `ZAR-113826`, `YNS 113826`, `zar113826` or a bare `113826`.
 *
 * WHY ANY PREFIX: `branch_groups.order_prefix` is per-company, author-defined and
 * up to 5 characters (migration 0343). Search used to hardcode `YNS`, so the
 * moment a second company existed every one of its orders became unfindable —
 * `ZAR-113826` fell through to a `customer_name ILIKE '%ZAR-113826%'` match and
 * returned nothing, even with the order visible in the list behind the dialog.
 *
 * The prefix carries no lookup value: `orders.order_number` is globally unique
 * (one sequence, shared across companies), so the digits alone identify the
 * order and company isolation is enforced separately by the caller's branch
 * scope. Matching any alphabetic prefix therefore keeps every company working
 * without the parser needing to know the prefix catalog.
 *
 * @returns the parsed order number, or `NaN` when the input is not an
 *          order-number-shaped string. NaN (not null) so existing call sites
 *          keep their `!Number.isNaN(n) && n > 0` guard unchanged.
 */
const ORDER_REF_RE = /^(?:[A-Z]{1,5}[- ]?)?(\d{1,7})$/i;

export function parseOrderNumberSearch(search: string): number {
  const match = search.trim().match(ORDER_REF_RE);
  if (!match?.[1]) return NaN;
  return parseInt(match[1], 10);
}
