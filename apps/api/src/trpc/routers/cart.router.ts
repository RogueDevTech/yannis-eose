import { z } from 'zod';
import { router, publicProcedure, permissionProcedure } from '../trpc';
import { CartService } from '../../cart/cart.service';
import { isAdminLevel } from '../../common/authz';
import { saveCartSchema } from '@yannis/shared';

let cartServiceInstance: CartService | null = null;

export function setCartService(service: CartService) {
  cartServiceInstance = service;
}

/** Exported for cross-router lookups (e.g. `*PageBundle` procedures). */
export function getCartService(): CartService {
  if (!cartServiceInstance) {
    throw new Error('CartService not initialized. Call setCartService() first.');
  }
  return cartServiceInstance;
}

export const cartRouter = router({
  /**
   * Save cart — called by Edge Worker when user fills name + phone.
   * Public procedure (no auth). When caller is authenticated, audit trail records that user.
   */
  save: publicProcedure
    .input(saveCartSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartService().save(input, ctx.user?.id ?? null);
    }),

  /**
   * Mark abandoned carts. Called by cron or admin. Audit trail uses current user when present.
   */
  markAbandoned: permissionProcedure('settings.write')
    .input(z.object({ thresholdMinutes: z.number().int().min(1).default(5) }))
    .mutation(async ({ input, ctx }) => {
      const count = await getCartService().markAbandoned(input.thresholdMinutes, ctx.user?.id ?? null);
      return { marked: count };
    }),

  /**
   * List PENDING carts for CS dashboard (cart abandonment).
   */
  listPending: permissionProcedure('cart.read')
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      return getCartService().listPending(input?.limit ?? 50);
    }),

  /**
   * List ABANDONED carts until cleared (delete). Paginated (`page`, `limit` max 100).
   *
   * Accepts `cart.read` (CS-side) OR `marketing.read` (Media Buyers / HoM viewing
   * cart abandonment on the Marketing orders page) — same OR-grant rationale as
   * `listActivity`. A Media Buyer is always auto-scoped to their own campaigns'
   * carts; they can never widen to the org-wide backlog.
   */
  listAbandoned: permissionProcedure('cart.read', 'marketing.read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(25),
          mediaBuyerId: z.string().uuid().optional(),
          branchId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      // Caller can see the raw phone inline only if they could already trigger
      // the audited reveal endpoint (`cart.delete` is the gate for reveal/delete).
      // SUPER_ADMIN bypasses permissions. CEO directive 2026-05-08.
      const canReveal =
        ctx.user.role === 'SUPER_ADMIN' ||
        (ctx.user.permissions ?? []).includes('cart.delete');
      // A Media Buyer (incl. a marketing-team supervisor — still role MEDIA_BUYER)
      // only ever sees their own campaigns' carts.
      const mediaBuyerId =
        ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : input?.mediaBuyerId;
      // Branch scope must match `marketing.ordersPageBundle`'s "Open carts" count
      // (`countAbandoned`) so the KPI and this list agree: the viewer's active
      // branch, unless an org-wide marketing viewer drilled into one media buyer.
      const orgWideViewer =
        isAdminLevel(ctx.user) || ctx.user.role === 'HEAD_OF_MARKETING';
      const branchId =
        input?.mediaBuyerId && orgWideViewer
          ? undefined
          : ctx.currentBranchId ?? undefined;
      return getCartService().listAbandoned({
        page: input?.page ?? 1,
        limit: input?.limit ?? 25,
        includeRawPhone: canReveal,
        mediaBuyerId,
        branchId,
      });
    }),

  /**
   * Live activity feed — PENDING/ABANDONED/CONVERTED carts in last 6h with linked order status.
   *
   * Accepts `cart.read` (CS-side) OR `marketing.read` (Marketing Overview live feed). The
   * activity feed is the same data either way — what differs is the scope filter the caller
   * applies. CS sees org-wide; Media Buyers / branch-scoped marketing viewers pass
   * `mediaBuyerId` / `branchId` so the service narrows the rows. Without the OR-grant, a
   * Media Buyer would need a brand-new `cart.read` grant just for this feed, which would
   * over-expose other procedures gated on `cart.read`. Keep this OR — it's the least-
   * privilege answer that preserves both sides.
   */
  listActivity: permissionProcedure('cart.read', 'marketing.read')
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(60),
          mediaBuyerId: z.string().uuid().optional(),
          branchId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getCartService().listActivity({
        limit: input?.limit ?? 60,
        mediaBuyerId: input?.mediaBuyerId,
        branchId: input?.branchId,
      });
    }),

  /**
   * Get cart abandonment stats for CS dashboard. Scoped to the viewer's active
   * branch — org-wide only when the branch switcher is on "All branches"
   * (`currentBranchId` null).
   */
  getStats: permissionProcedure('cart.read').query(async ({ ctx }) => {
    return getCartService().getStats(ctx.currentBranchId);
  }),

  /**
   * Fetch one cart by id (any status) — powers the "View cart" quick-detail
   * modal on the recovered-from-cart orders list and the Marketing orders
   * cart-abandonment view. `cart.read` OR `marketing.read` (so Media Buyers can
   * open their own carts).
   *
   * The cart-detail modal always shows the customer's full number: a cart is a
   * pre-order lead the viewer is expected to follow up on, so `includeRawPhone`
   * is unconditional here (CEO directive 2026-05-22). A Media Buyer can still
   * only inspect a cart from one of their own campaigns.
   */
  getById: permissionProcedure('cart.read', 'marketing.read')
    .input(z.object({ cartId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const requireMediaBuyerId =
        ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : undefined;
      return getCartService().getById(input.cartId, {
        includeRawPhone: true,
        requireMediaBuyerId,
      });
    }),

  /**
   * Count open abandoned carts — lightweight stat for dashboard overview strips.
   * Gated on `marketing.read` (not `cart.read`) so Media Buyers and supervisors
   * can see their own cart abandonment count without over-exposing other cart procs.
   */
  countAbandoned: permissionProcedure('marketing.read')
    .input(
      z
        .object({
          mediaBuyerId: z.string().uuid().optional(),
          branchId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const mediaBuyerId = ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : input?.mediaBuyerId;
      return { count: await getCartService().countAbandoned({ mediaBuyerId, branchId: input?.branchId }) };
    }),

  /**
   * Delete an abandoned cart. Head of CS / SuperAdmin only.
   */
  deleteAbandoned: permissionProcedure('cart.delete')
    .input(z.object({ cartId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getCartService().deleteAbandoned(input.cartId, ctx.user.id);
    }),

  /**
   * Reveal the raw customer phone for a dropped-off cart so the rep can
   * Call / SMS / WhatsApp the customer (CEO directive 2026-05-08).
   *
   * Mutation, not a query — the reveal IS the action; auditing it under the
   * acting user's session is the whole point. Same `cart.delete` gate as the
   * Clear button so only roles trusted to act on the backlog can reveal.
   */
  revealPhoneForAbandoned: permissionProcedure('cart.delete')
    .input(z.object({ cartId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getCartService().revealPhoneForAbandonedCart(input.cartId, ctx.user.id);
    }),
});
