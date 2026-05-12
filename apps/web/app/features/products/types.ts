export interface ProductOffer {
  label: string;
  qty: number;
  price: string;
  /** Gallery URLs for this offer tier (GCS/public object storage or other HTTPS). */
  imageUrls?: string[];
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  /** Hydrated from offer templates for lists/previews — not edited on the product page. */
  offers: ProductOffer[];
  /** Catalog gallery (HTTPS URLs). */
  galleryImageUrls: string[];
  baseSalePrice: string;
  /** Cost is stripped from API responses unless viewer has finance access. */
  costPrice: string | null;
  category: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandName: string | null;
  status: string;
  createdAt: string;
  /** Total available stock summed across all locations (stock - reserved). */
  totalStock?: number;
}

export const PRODUCT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-danger',
  ARCHIVED: 'badge-warning',
};
