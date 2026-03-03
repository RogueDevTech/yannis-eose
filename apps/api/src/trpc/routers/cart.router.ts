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
   * Public procedure (no auth).
   */
  save: publicProcedure
    .input(saveCartSchema)
    .mutation(async ({ input }) => {
      return getCartService().save(input);
    }),

  /**
   * Mark abandoned carts. Called by cron or admin.
   */
  markAbandoned: permissionProcedure('settings.write')
    .input(z.object({ thresholdMinutes: z.number().int().min(1).default(15) }))
    .mutation(async ({ input }) => {
      const count = await getCartService().markAbandoned(input.thresholdMinutes);
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
   * Get cart abandonment stats for CS dashboard.
   */
  getStats: permissionProcedure('cart.read').query(async () => {
    return getCartService().getStats();
  }),
});
