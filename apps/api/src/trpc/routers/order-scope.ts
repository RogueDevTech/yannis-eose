import { TRPCError } from '@trpc/server';
import { getOrdersService, getFollowUpConfigService } from './orders.router';
import { getCartOrdersService } from './cart-orders.router';

/**
 * Company-isolation guard for an order id that may live in ANY of the three
 * order tables (`orders`, `follow_up_orders`, `cart_orders`).
 *
 * The order detail page is SHARED across all three pipelines, so a handful of
 * its procedures legitimately receive a cart or follow-up id. A single-table
 * guard in front of them throws NOT_FOUND before the procedure can do its job,
 * which is what took cart + follow-up mark-delivered / adjust-price / copy /
 * assign-agent offline on 2026-09-09.
 *
 * Two of the guarded procedures have services that genuinely probe all three
 * tables — `getClipboardSummaryText` and `listAllocatableLocations` both
 * document that fallback inline, and the guard was the only thing stopping it.
 * The other two (`listItemOffers` → `listOrderItemOffers`,
 * `listProductsForAdjust` → `isOrderNonBaseCurrency`) are still orders-table
 * only in the service: they were already degraded for cart / follow-up BEFORE
 * the guard existed, and widening the guard is correct but not by itself
 * sufficient to make them serve those pipelines. Giving those two a real
 * multi-table fallback is tracked separately.
 *
 * Each per-table guard throws NOT_FOUND when the id isn't in that table and
 * FORBIDDEN when it is but belongs to another company — so "no table admitted
 * it" is the failure case, and we surface FORBIDDEN rather than leaking which
 * table (if any) holds the id.
 *
 * Org-wide callers (`effectiveBranchIds == null`) bypass, matching every other
 * scope guard. An EMPTY array means "company selected but scope unresolved" and
 * deliberately still denies (see `isEntityInScope`).
 */
export async function assertOrderIdInAnyTableScope(
  orderId: string,
  effectiveBranchIds: string[] | null | undefined,
): Promise<void> {
  if (effectiveBranchIds == null) return; // org-wide caller

  for (const check of [
    () => getOrdersService().assertOrderInCompanyScope(orderId, effectiveBranchIds),
    () => getFollowUpConfigService().assertFollowUpOrderInCompanyScope(orderId, effectiveBranchIds),
    () => getCartOrdersService().assertCartOrderInScope(orderId, effectiveBranchIds),
  ]) {
    try {
      await check();
      return; // admitted by one of the tables
    } catch {
      // Not in this table, or not in this company — try the next.
    }
  }

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'This order is not in your company.',
  });
}
