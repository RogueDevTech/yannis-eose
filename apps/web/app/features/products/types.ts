export interface ProductOffer {
  label: string;
  qty: number;
  price: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  offers: ProductOffer[];
  baseSalePrice: string;
  costPrice: string | null;
  category: string | null;
  status: string;
  createdAt: string;
}

export const PRODUCT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-danger',
  ARCHIVED: 'badge-warning',
};
