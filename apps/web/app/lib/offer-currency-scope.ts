/**
 * Web mirror of the API's offer-price country scope (see
 * apps/api/src/common/authz/offer-currency-scope.ts). Purely for UX: the server
 * is the authoritative guard. Decides which currencies' offer prices the current
 * user may edit so the form can lock the rest.
 *
 * Scope follows the user's PERMANENT country assignment (`currencyCodes`), NOT
 * the top-bar view switcher (`currentCurrencyCode`): an all-countries admin
 * merely viewing Tanzania must still be able to edit NGN prices.
 */

const ADMIN_LEVEL_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
const BASE_CURRENCY_CODE = 'NGN';

/**
 * True when the user may edit EVERY currency's offer price. Mirrors the API's
 * `canViewAllCountries`: MEDIA_BUYER, admin-class, or `countries.view_all`.
 */
export function canEditAllCurrencies(user: {
  role?: string | null;
  permissions?: string[] | null;
}): boolean {
  const role = user.role ?? '';
  if (role === 'MEDIA_BUYER') return true;
  if (ADMIN_LEVEL_ROLES.has(role)) return true;
  return (user.permissions ?? []).includes('countries.view_all');
}

/**
 * Resolve the currency codes the user may edit offer prices for.
 * @returns `null` when the user may edit ANY currency (view-all); otherwise the
 *          explicit uppercase set (never empty — falls back to `['NGN']`,
 *          matching the API's effectiveCurrencyCodes semantics).
 */
export function editableOfferCurrencyCodes(user: {
  role?: string | null;
  permissions?: string[] | null;
  currencyCodes?: string[] | null;
}): string[] | null {
  if (canEditAllCurrencies(user)) return null;
  const assigned = (user.currencyCodes ?? [])
    .map((c) => c.toUpperCase())
    .filter(Boolean);
  return assigned.length > 0 ? Array.from(new Set(assigned)) : [BASE_CURRENCY_CODE];
}
