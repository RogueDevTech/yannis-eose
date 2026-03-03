import { z } from 'zod';

// ============================================
// Product Offer (bundle pricing)
// ============================================

export const productOfferSchema = z.object({
  label: z.string().min(1, 'Offer label is required'),
  qty: z.number().int().min(1, 'Quantity must be at least 1'),
  price: z.coerce.number().min(0).multipleOf(0.01),
});

export type ProductOffer = z.infer<typeof productOfferSchema>;

// ============================================
// Create Product
// ============================================

export const createProductSchema = z.object({
  name: z.string().min(2, 'Product name is required'),
  description: z.string().optional(),
  offers: z.array(productOfferSchema).min(1, 'At least one offer is required'),
  costPrice: z.coerce.number().min(0).multipleOf(0.01),
  category: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  initialStockQty: z.number().int().min(0).optional(),
  initialStockLocationId: z.string().uuid().nullable().optional(),
}).refine(
  (data) => {
    if ((data.initialStockQty ?? 0) > 0) return !!data.initialStockLocationId;
    return true;
  },
  { message: 'Location is required when adding initial stock', path: ['initialStockLocationId'] },
);

export type CreateProductInput = z.infer<typeof createProductSchema>;

// ============================================
// Update Product
// ============================================

export const updateProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  offers: z.array(productOfferSchema).min(1).optional(),
  costPrice: z.coerce.number().min(0).multipleOf(0.01).optional(),
  category: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ============================================
// List Products
// ============================================

export const listProductsSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'baseSalePrice', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListProductsInput = z.infer<typeof listProductsSchema>;
