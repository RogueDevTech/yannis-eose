import type { OrderStatus } from '@yannis/shared';

/**
 * Statuses that can never make an existing order block a NEW order.
 *
 * CANCELLED/DELETED: the order does not exist as far as the business is
 * concerned.
 *
 * DELIVERED / PARTIALLY_DELIVERED / REMITTED: the customer received goods and —
 * for REMITTED — the cash has been collected and remitted. That is proof the
 * earlier submission was genuine and completed, which is exactly what the dedup
 * guard exists to establish. Treating it as a duplicate blocks a repeat purchase
 * from a customer who has already paid us once.
 *
 * Measured on prod 2026-09-11: REMITTED was the single largest blocker in the
 * system (665 blocked attempts / 434 customers in 30 days); with DELIVERED, 798
 * attempts across 540 customers. Genuine double-submits in the same data cluster
 * within SECONDS (same phone, order minutes old), so excluding completed orders
 * does not weaken that protection.
 */
const NEVER_EXISTED: readonly OrderStatus[] = ['CANCELLED', 'DELETED'];
const COMPLETED: readonly OrderStatus[] = ['DELIVERED', 'PARTIALLY_DELIVERED', 'REMITTED'];

/**
 * @param includeCompleted
 *   `false` (default) — DUPLICATE REJECTION, used by every order-create path.
 *   Completed orders are excluded so a customer who already received their goods
 *   can buy again.
 *
 *   `true` — CART RECOVERY lookup ("which order did this abandoned cart become?").
 *   Completed orders MUST still match: without them recovery creates a SECOND
 *   live order and the cart is stranded in the abandonment queue forever.
 */
export function dedupExcludedStatuses(includeCompleted = false): OrderStatus[] {
  return includeCompleted ? [...NEVER_EXISTED] : [...NEVER_EXISTED, ...COMPLETED];
}
