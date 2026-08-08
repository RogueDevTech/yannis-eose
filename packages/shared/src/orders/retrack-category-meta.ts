/**
 * Retrack category metadata — single source of truth shared by API + web.
 *
 * Finance picks one of these when directly retracking an order. Every category
 * opens the retrack hold (blocks re-delivery/re-remittance until CS/HoCS resolves).
 * `priceAffecting` categories additionally accept a corrected-value hint and expect
 * a price/quantity correction as part of the fix. Keep the keys in sync with the
 * `retrack_category` pgEnum (schema/enums.ts) and migration 0303.
 */

export const RETRACK_CATEGORIES = [
  'wrong_remittance_price',
  'understated_overstated_price',
  'wrong_quantity',
  'wrong_delivery_agent',
  'duplicate_delivery',
  'not_delivered_moved_by_cs',
] as const;

export type RetrackCategory = (typeof RETRACK_CATEGORIES)[number];

export interface RetrackCategoryMeta {
  key: RetrackCategory;
  /** Short label for the dropdown + banner. */
  label: string;
  /** One-line help shown under the dropdown. */
  description: string;
  /**
   * Whether this category concerns the order's money/quantity. Price-affecting
   * categories surface the corrected-value hint field and imply a price/quantity
   * correction. (Informational: the hold blocks re-delivery for ALL categories.)
   */
  priceAffecting: boolean;
  /** Banner tone. 'danger' for money/delivery-integrity, 'warning' otherwise. */
  tone: 'danger' | 'warning';
}

export const RETRACK_CATEGORY_META: Record<RetrackCategory, RetrackCategoryMeta> = {
  wrong_remittance_price: {
    key: 'wrong_remittance_price',
    label: 'Wrong remittance price',
    description: 'Cash remitted does not match the posted order value.',
    priceAffecting: true,
    tone: 'danger',
  },
  understated_overstated_price: {
    key: 'understated_overstated_price',
    label: 'Understated / overstated price',
    description: 'Posted order value is wrong (too low or too high).',
    priceAffecting: true,
    tone: 'danger',
  },
  wrong_quantity: {
    key: 'wrong_quantity',
    label: 'Wrong quantity',
    description: 'Wrong quantity on the order. Correct the quantity before delivery.',
    priceAffecting: true,
    tone: 'danger',
  },
  wrong_delivery_agent: {
    key: 'wrong_delivery_agent',
    label: 'Wrong delivery agent',
    description: 'Assigned to the wrong delivery agent or CS closer.',
    priceAffecting: false,
    tone: 'warning',
  },
  duplicate_delivery: {
    key: 'duplicate_delivery',
    label: 'Duplicate / multiple delivery',
    description: 'Duplicate or multiple delivery recorded for the same order.',
    priceAffecting: false,
    tone: 'danger',
  },
  not_delivered_moved_by_cs: {
    key: 'not_delivered_moved_by_cs',
    label: 'Not delivered (moved in error)',
    description: 'Order was not delivered but was mistakenly moved forward by CS.',
    priceAffecting: false,
    tone: 'danger',
  },
};

/** Dropdown options in display order. */
export const RETRACK_CATEGORY_OPTIONS = RETRACK_CATEGORIES.map((k) => ({
  value: k,
  label: RETRACK_CATEGORY_META[k].label,
}));

export function retrackCategoryLabel(key: string | null | undefined): string {
  if (!key) return '';
  return (RETRACK_CATEGORY_META as Record<string, RetrackCategoryMeta>)[key]?.label ?? key;
}

export function isPriceAffectingRetrackCategory(key: string | null | undefined): boolean {
  if (!key) return false;
  return (RETRACK_CATEGORY_META as Record<string, RetrackCategoryMeta>)[key]?.priceAffecting ?? false;
}
