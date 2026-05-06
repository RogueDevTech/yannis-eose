import { canonicalPermissionCode } from '~/lib/permission-codes';

/** Minimal session type for loaders / route handlers. */
export type OfferTierSessionUser = { role: string; permissions?: string[] };

/** Head of Marketing, Stock Manager (permission), Admin-class can manage tiers from marketing forms. */
export function userCanManageOfferTemplates(user: OfferTierSessionUser): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return true;
  const codes = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return codes.has('products.offers');
}
