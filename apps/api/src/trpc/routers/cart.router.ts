import { z } from 'zod';
import { router, publicProcedure, permissionProcedure } from '../trpc';
import { CartService } from '../../cart/cart.service';
import { saveCartSchema } from '@yannis/shared';

let cartServiceInstance: CartService | null = null;

export function setCartService(service: CartService) {
  cartServiceInstance = service;
}

function getCartService(): CartService {
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
   * List ABANDONED carts in the last 24h for CS dashboard (Cart Abandonment tab).
   */
  listAbandoned: permissionProcedure('cart.read')
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      return getCartService().listAbandoned(input?.limit ?? 50);
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
});
