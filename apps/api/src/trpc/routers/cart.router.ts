import { z } from 'zod';
import { router, publicProcedure, permissionProcedure } from '../trpc';
import { CartService } from '../../cart/cart.service';
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
   */
  listAbandoned: permissionProcedure('cart.read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(25),
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
      return getCartService().listAbandoned({
        page: input?.page ?? 1,
        limit: input?.limit ?? 25,
        includeRawPhone: canReveal,
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
   * Get cart abandonment stats for CS dashboard.
   */
  getStats: permissionProcedure('cart.read').query(async () => {
    return getCartService().getStats();
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
