import { z } from 'zod';

// ============================================
// Product Offer (response shape / legacy JSON)
// ============================================

/** Max images per offer tier on public forms (stored on `offer_templates.image_urls`). */
export const MAX_OFFER_TIER_IMAGES = 8;

/** @deprecated Alias for MAX_OFFER_TIER_IMAGES (existing UI imports). */
export const MAX_PRODUCT_OFFER_IMAGES = MAX_OFFER_TIER_IMAGES;

export const productOfferSchema = z.object({
  label: z.string().min(1, 'Offer label is required'),
  qty: z.number().int().min(1, 'Quantity must be at least 1'),
  price: z.coerce.number().min(0).multipleOf(0.01),
  /** Public URLs (e.g. R2/S3) for this tier — optional */
  imageUrls: z
    .array(z.string().url('Each image must be a valid URL'))
    .max(MAX_OFFER_TIER_IMAGES)
    .optional()
    .transform((v) => (Array.isArray(v) ? v : [])),
});

export type ProductOffer = z.infer<typeof productOfferSchema>;

/** Max catalog gallery images (`products.gallery_image_urls`). */
export const MAX_PRODUCT_GALLERY_IMAGES = 24;

export const galleryImageUrlsSchema = z
  .array(z.string().url('Each image must be a valid URL'))
  .max(MAX_PRODUCT_GALLERY_IMAGES)
  .optional()
  .transform((v) => (Array.isArray(v) ? v : []));

// ============================================
// Create Product
// ============================================

export const createProductSchema = z.object({
  name: z.string().min(2, 'Product name is required'),
  description: z.string().optional(),
  /**
   * Public list / sort price (“from” price) — merchandising tiers live in
   * `offer_templates`. Optional: products are sold via offer tiers, so this
   * defaults to 0 and is auto-synced down to the cheapest offer when tiers
   * change on a Marketing form.
   */
  baseSalePrice: z.coerce.number().min(0).multipleOf(0.01).optional().default(0),
  /** Optional reference cost. Real COGS is FIFO landed cost from shipment lines. */
  costPrice: z.coerce.number().min(0).multipleOf(0.01).optional(),
  galleryImageUrls: galleryImageUrlsSchema,
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
  baseSalePrice: z.coerce.number().min(0).multipleOf(0.01).optional(),
  costPrice: z.coerce.number().min(0).multipleOf(0.01).optional(),
  galleryImageUrls: galleryImageUrlsSchema.optional(),
  category: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Request to archive a product — Super Admin archives immediately; others create a permission request. */
export const requestProductArchiveSchema = z.object({
  productId: z.string().uuid(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type RequestProductArchiveInput = z.infer<typeof requestProductArchiveSchema>;

// ============================================
// List Products
// ============================================

export const listProductsSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
  sortBy: z.enum(['name', 'baseSalePrice', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListProductsInput = z.infer<typeof listProductsSchema>;

// ============================================
// Bundle Components
// ============================================

export const bundleComponentSchema = z.object({
  componentProductId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

export const setBundleComponentsSchema = z.object({
  productId: z.string().uuid(),
  /** Empty array removes all components (product is no longer a bundle). */
  components: z.array(bundleComponentSchema).max(20, 'A bundle can have at most 20 components'),
});

export type SetBundleComponentsInput = z.infer<typeof setBundleComponentsSchema>;
