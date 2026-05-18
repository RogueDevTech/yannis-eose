import type { ProductOfferRow } from './types';

export interface MinimalOfferTemplateForPreview {
  id: string;
  name: string;
  quantity: number;
  price: string | number;
  status: string;
  /** Public image URLs for this tier (same as Edge `offer-thumb`). */
  imageUrls?: string[];
}

/**
 * Mirrors public Edge behaviour: only ACTIVE tiers; empty `selectedIds` ⇒ all ACTIVE tiers for the product.
 */
export function templatesToPreviewOffers(
  templates: MinimalOfferTemplateForPreview[],
  selectedIds: readonly string[],
): ProductOfferRow[] {
  const active = templates.filter((t) => String(t.status).toUpperCase() === 'ACTIVE');
  const filtered =
    selectedIds.length > 0 ? active.filter((t) => selectedIds.includes(t.id)) : active;
  return filtered.map((t) => ({
    label: t.name,
    qty: typeof t.quantity === 'number' && Number.isFinite(t.quantity) ? t.quantity : Number.parseInt(String(t.quantity), 10) || 1,
    price: typeof t.price === 'number' ? String(t.price) : String(t.price ?? ''),
    ...(Array.isArray(t.imageUrls) && t.imageUrls.length > 0 ? { imageUrls: t.imageUrls } : {}),
  }));
}
