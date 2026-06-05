import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  requestProductArchiveSchema,
  setBundleComponentsSchema,
} from '@yannis/shared';
import type { ProductsService } from '../../products/products.service';
import { CacheService } from '../../common/cache/cache.service';

let productsServiceInstance: ProductsService | null = null;
let productsCacheService: CacheService | null = null;

export function setProductsService(service: ProductsService) {
  productsServiceInstance = service;
}

export function setProductsCacheService(service: CacheService) {
  productsCacheService = service;
}

async function invalidateProductsOptionsCache(): Promise<void> {
  if (!productsCacheService) return;
  await productsCacheService.delPattern('cache:products:options:*').catch(() => {
    /* fail-open */
  });
}

/** Exported for cross-router lookups (e.g. `marketing.ordersPageBundle`). */
export function getProductsService(): ProductsService {
  if (!productsServiceInstance) {
    throw new Error('ProductsService not initialized. Call setProductsService() first.');
  }
  return productsServiceInstance;
}

const PRODUCTS_OPTIONS_TTL_SECONDS = 60 * 15;

export const productsRouter = router({
  /**
   * List products — accessible to most authenticated roles.
   * Finance fields are stripped automatically by CLS middleware.
   */
  list: authedProcedure
    .input(listProductsSchema)
    .query(async ({ input, ctx }) => {
      return getProductsService().list(input, ctx.user.id, ctx.user.role);
    }),

  /**
   * Minimal product options for dropdowns / label resolution.
   * Cacheable (Redis) because the response shape is small and stable.
   */
  options: authedProcedure
    .input(
      z
        .object({
          status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const effective = { status: input?.status ?? 'ACTIVE' } as const;

      if (!productsCacheService) {
        return getProductsService().listOptions(effective, ctx.user.id, ctx.user.role);
      }

      const key =
        'cache:products:options:v2:' +
        CacheService.hashInput({
          status: effective.status,
          viewerRole: ctx.user.role,
          viewerId: ctx.user.id, // MEDIA_BUYER catalog scoping can vary per user
        });

      return productsCacheService.getOrSet(key, PRODUCTS_OPTIONS_TTL_SECONDS, () =>
        getProductsService().listOptions(effective, ctx.user.id, ctx.user.role),
      );
    }),

  /**
   * Get single product by ID.
   * Finance fields are stripped automatically by CLS middleware.
   */
  getById: authedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getProductsService().getById(input.productId, ctx.user.id, ctx.user.role);
    }),

  /**
   * Create a new product.
   * SuperAdmin, Stock Manager, or Head of Logistics only.
   */
  create: permissionProcedure('products.create')
    .input(createProductSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getProductsService().create(input, ctx.user);
      await invalidateProductsOptionsCache();
      return res;
    }),

  /**
   * Update a product.
   */
  update: permissionProcedure('products.update')
    .input(updateProductSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getProductsService().update(input, ctx.user);
      await invalidateProductsOptionsCache();
      return res;
    }),

  /**
   * Archive product: Super Admin applies immediately; others create a PENDING request for Super Admin.
   */
  requestArchive: permissionProcedure('products.update')
    .input(requestProductArchiveSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getProductsService().requestArchive(input, ctx.user);
      await invalidateProductsOptionsCache();
      return res;
    }),

  /**
   * Get distinct product categories.
   */
  categories: authedProcedure.query(async ({ ctx }) => {
    return getProductsService().getCategories(ctx.user.id, ctx.user.role);
  }),

  /**
   * Get bundle components for a product.
   */
  getBundleComponents: authedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getProductsService().getBundleComponents(input.productId);
    }),

  /**
   * Set bundle components for a product (replaces all existing).
   * Requires products.update permission.
   */
  setBundleComponents: permissionProcedure('products.update')
    .input(setBundleComponentsSchema)
    .mutation(async ({ input, ctx }) => {
      return getProductsService().setBundleComponents(
        input.productId,
        input.components,
        ctx.user,
      );
    }),
});
