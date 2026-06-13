import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  createProductCategorySchema,
  updateProductCategorySchema,
  listProductCategoriesSchema,
} from '@yannis/shared';
import type { ProductCategoriesService } from '../../products/product-categories.service';

let serviceInstance: ProductCategoriesService | null = null;

export function setProductCategoriesService(service: ProductCategoriesService) {
  serviceInstance = service;
}

function getService(): ProductCategoriesService {
  if (!serviceInstance) {
    throw new Error('ProductCategoriesService not initialized. Call setProductCategoriesService() first.');
  }
  return serviceInstance;
}

export const productCategoriesRouter = router({
  /**
   * List categories with filtering and pagination.
   */
  list: authedProcedure
    .input(listProductCategoriesSchema)
    .query(async ({ input, ctx }) => {
      return getService().list(input, ctx.activeGroupId);
    }),

  /**
   * Get a single category by ID.
   */
  getById: authedProcedure
    .input(z.object({ categoryId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getService().getById(input.categoryId);
    }),

  /**
   * Get all active categories for dropdown selectors.
   */
  listActive: authedProcedure.query(async () => {
    return getService().listActive();
  }),

  /**
   * Create a new product category.
   */
  create: permissionProcedure('categories.write')
    .input(createProductCategorySchema)
    .mutation(async ({ input, ctx }) => {
      return getService().create(input, ctx.user, ctx.activeGroupId);
    }),

  /**
   * Update a product category.
   */
  update: permissionProcedure('categories.write')
    .input(updateProductCategorySchema)
    .mutation(async ({ input, ctx }) => {
      return getService().update(input, ctx.user);
    }),
});
