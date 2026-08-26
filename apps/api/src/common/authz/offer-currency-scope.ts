/**
 * Country-scoped OFFER PRICE editing (multi-country).
 *
 * An offer carries prices in several currencies (base NGN on the parent row +
 * one row per non-default currency in the `*_prices` side-table). Who may edit
 * which currency's price is a HARD scope:
 *   - `canViewAllCountries(user)` (MB / admin-class / `countries.view_all`) may
 *     edit EVERY currency's price.
 *   - A country-scoped user (e.g. a Nigeria-only Stock Manager) may edit ONLY
 *     the prices for the currencies they are assigned in `user_countries`.
 *
 * IMPORTANT — this scope is the user's PERMANENT assignment (`user.currencyCodes`),
 * NOT `ctx.effectiveCurrencyCodes`. The latter is narrowed by the top-bar country
 * switcher, so an all-countries admin merely *viewing* Tanzania would otherwise be
 * wrongly blocked from editing NGN prices. Edit rights follow assignment, not the
 * transient view.
 *
 * The base (parent-row) price is always NGN by design, so editing it requires
 * `NGN` to be in the editable set (or view-all).
 */
import { canViewAllCountries } from '../authz';

const BASE_CURRENCY_CODE = 'NGN';

/**
 * Resolve the set of currency codes an actor may edit offer prices for.
 * @returns `null` when the actor may edit ANY currency (view-all); otherwise the
 *          explicit uppercase set of editable codes (never empty — falls back to
 *          `['NGN']`, mirroring `trpc/context.ts` effectiveCurrencyCodes).
 */
export function editableCurrencyCodesForActor(user: {
  role: string;
  permissions?: string[];
  currencyCodes?: string[];
}): string[] | null {
  if (canViewAllCountries(user)) return null;
  const assigned = (user.currencyCodes ?? [])
    .map((c) => c.toUpperCase())
    .filter(Boolean);
  return assigned.length > 0 ? Array.from(new Set(assigned)) : [BASE_CURRENCY_CODE];
}

/** True when the actor may edit the given currency's offer price. */
export function canEditCurrency(
  editable: string[] | null,
  currencyCode: string,
): boolean {
  if (editable == null) return true; // view-all
  return editable.includes(currencyCode.toUpperCase());
}

/**
 * Merge an incoming non-default `prices` map against what is currently stored,
 * enforcing that a scoped actor can only add/change/remove currencies in their
 * editable set. Currencies outside the actor's scope are preserved verbatim from
 * `existing`, so a Nigeria-only submit can never wipe TSh/GH₵ rows.
 *
 * @param existing  currently-stored non-default prices (uppercase code → price).
 * @param incoming  the actor's submitted non-default prices; `undefined` means
 *                  "not touching currency prices" and returns `existing` intact.
 * @param editable  result of {@link editableCurrencyCodesForActor}.
 * @returns the merged non-default price map to persist (uppercase codes).
 */
export function mergeScopedPrices(
  existing: Record<string, number>,
  incoming: Record<string, number> | undefined,
  editable: string[] | null,
): Record<string, number> {
  if (incoming === undefined) return { ...existing };

  const normExisting: Record<string, number> = {};
  for (const [code, v] of Object.entries(existing)) {
    normExisting[code.toUpperCase()] = v;
  }
  const normIncoming: Record<string, number> = {};
  for (const [code, v] of Object.entries(incoming)) {
    normIncoming[code.toUpperCase()] = v;
  }

  // View-all: incoming is authoritative (full replace, as before).
  if (editable == null) return normIncoming;

  const editableSet = new Set(editable.map((c) => c.toUpperCase()));
  // Base NGN never lives in this side-table, so ignore it here.
  editableSet.delete(BASE_CURRENCY_CODE);

  // Start from every out-of-scope existing currency (preserved untouched)...
  const merged: Record<string, number> = {};
  for (const [code, v] of Object.entries(normExisting)) {
    if (!editableSet.has(code)) merged[code] = v;
  }
  // ...then apply the actor's in-scope edits (add/change; a dropped in-scope
  // code simply doesn't reappear → treated as "unpriced" → removed).
  for (const [code, v] of Object.entries(normIncoming)) {
    if (editableSet.has(code)) merged[code] = v;
  }
  return merged;
}

/**
 * Whether the actor may write the base (NGN) price on the parent offer row.
 * Base price is NGN by design, so this is just `canEditCurrency(editable, 'NGN')`.
 */
export function canEditBasePrice(editable: string[] | null): boolean {
  return canEditCurrency(editable, BASE_CURRENCY_CODE);
}

/**
 * Offer-group variant of {@link mergeScopedPrices}. Offer groups rebuild all
 * items on edit (delete + reinsert), so their per-item, per-currency prices are
 * matched to the PRE-EDIT snapshot by a stable natural key (productId · label ·
 * quantity) rather than a row id. For each new item we preserve every
 * out-of-scope currency price found on the matching old item, then overlay the
 * actor's in-scope submitted prices.
 *
 * @param existingByKey  old per-item prices keyed by {@link offerGroupItemKey}.
 * @param key            natural key of the item currently being rebuilt.
 * @param incoming       the actor's submitted per-currency prices for this item.
 * @param editable       result of {@link editableCurrencyCodesForActor}.
 */
export function mergeScopedItemPrices(
  existingByKey: Map<string, Record<string, number>>,
  key: string,
  incoming: Record<string, number> | undefined,
  editable: string[] | null,
): Record<string, number> {
  const existing = existingByKey.get(key) ?? {};
  return mergeScopedPrices(existing, incoming, editable);
}

/**
 * Stable natural key for matching offer-group items across a rebuild. Includes
 * `sortOrder` (the line's stable position — the web form preserves line order on
 * edit) so two lines with the same product/label/quantity don't collide and
 * cross-restore each other's out-of-scope prices. Callers pass the incoming
 * item's `sortOrder ?? index` and the existing row's stored `sort_order` so both
 * sides align on the same ordinal.
 */
export function offerGroupItemKey(item: {
  productId: string;
  label?: string | null;
  quantity?: number | null;
  sortOrder?: number | null;
}): string {
  return [item.sortOrder ?? 0, item.productId, item.label ?? '', item.quantity ?? 1].join('::');
}
