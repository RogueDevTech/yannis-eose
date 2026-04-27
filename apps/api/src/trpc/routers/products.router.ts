import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  requestProductArchiveSchema,
} from '@yannis/shared';
import type { ProductsService } from '../../products/products.service';

let productsServiceInstance: ProductsService | null = null;

export function setProductsService(service: ProductsService) {
  productsServiceInstance = service;
}

function getProductsService(): ProductsService {
  if (!productsServiceInstance) {
    throw new Error('ProductsService not initialized. Call setProductsService() first.');
  }
  return productsServiceInstance;
}

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
      return getProductsService().create(input, ctx.user);
    }),

  /**
   * Update a product.
   */
  update: permissionProcedure('products.update')
    .input(updateProductSchema)
    .mutation(async ({ input, ctx }) => {
      return getProductsService().update(input, ctx.user);
    }),

  /**
   * Archive product: Super Admin applies immediately; others create a PENDING request for Super Admin.
   */
  requestArchive: permissionProcedure('products.update')
    .input(requestProductArchiveSchema)
    .mutation(async ({ input, ctx }) => {
      return getProductsService().requestArchive(input, ctx.user);
    }),

  /**
   * Get distinct product categories.
   */
  categories: authedProcedure.query(async ({ ctx }) => {
    return getProductsService().getCategories(ctx.user.id, ctx.user.role);
  }),
});
