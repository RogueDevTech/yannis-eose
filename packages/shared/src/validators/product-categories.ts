import { z } from 'zod';

// ============================================
// Create Product Category
// ============================================

export const createProductCategorySchema = z.object({
  name: z.string().min(2, 'Category name is required'),
  brandName: z.string().min(1, 'Brand name is required'),
  brandPhone: z.string().optional(),
  brandEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  brandWhatsapp: z.string().optional(),
  smsSenderId: z.string().optional(),
});

export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

// ============================================
// Update Product Category
// ============================================

export const updateProductCategorySchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(2).optional(),
  brandName: z.string().min(1).optional(),
  brandPhone: z.string().nullable().optional(),
  brandEmail: z.string().email().nullable().optional().or(z.literal('')),
  brandWhatsapp: z.string().nullable().optional(),
  smsSenderId: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;

// ============================================
// List Product Categories
// ============================================

export const listProductCategoriesSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});

export type ListProductCategoriesInput = z.infer<typeof listProductCategoriesSchema>;
