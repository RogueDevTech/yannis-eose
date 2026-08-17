import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { type CurrencyInfo, NGN, hasMultipleCurrencies as sharedHasMultiple, currencyColorForCode, currencyByCode } from '@yannis/shared';

/**
 * App-wide ACTIVE currency catalog for the caller's company.
 *
 * The multi-currency feature is DORMANT until this list has 2+ entries — the
 * whole app can cheaply read `useHasMultipleCurrencies()` to decide whether to
 * render any currency dropdown / filter / form toggle. When there's only the
 * seeded NGN default, everything behaves exactly as the single-currency world.
 */
export type CurrencyCatalogEntry = CurrencyInfo;

const CurrenciesCatalogContext = createContext<CurrencyCatalogEntry[]>([NGN]);

/** Resolved active currency list from `DashboardLayout` (after streaming currencies.listActive). */
export function CurrenciesCatalogProvider({ value, children }: { value: CurrencyCatalogEntry[]; children: ReactNode }) {
  // Never provide an empty list — fall back to NGN so formatting always resolves.
  const safe = value && value.length > 0 ? value : [NGN];
  return <CurrenciesCatalogContext.Provider value={safe}>{children}</CurrenciesCatalogContext.Provider>;
}

export function useCurrenciesCatalog(): CurrencyCatalogEntry[] {
  return useContext(CurrenciesCatalogContext);
}

/** The master gate — true only when an admin has added a 2nd active currency. */
export function useHasMultipleCurrencies(): boolean {
  const list = useCurrenciesCatalog();
  return useMemo(() => sharedHasMultiple(list), [list]);
}

/** The company's base (default) currency, or NGN. */
export function useBaseCurrency(): CurrencyInfo {
  const list = useCurrenciesCatalog();
  return useMemo(() => list.find((c) => c.isDefault && c.active) ?? list.find((c) => c.isDefault) ?? NGN, [list]);
}

/**
 * The accent colour to tint a record's order#/amount for a currency code, or
 * `null` to render neutral. Null for the base/default currency, uncoloured
 * currencies, and unknown codes — so base (NGN) rows and the single-currency
 * world keep the current look. Feed the returned value into an inline `color`
 * style; when null, apply no style.
 */
export function useCurrencyColor(code: string | null | undefined): string | null {
  const list = useCurrenciesCatalog();
  return useMemo(() => currencyColorForCode(list, code), [list, code]);
}

/**
 * The display symbol for a currency code (e.g. '₦', 'GH₵'), resolved from the
 * live catalog. Falls back to the base currency's symbol when the code is
 * absent, and to the uppercased code for an unknown currency. Use for input
 * addons / prefixes that must match the record's frozen currency.
 */
export function useCurrencySymbol(code: string | null | undefined): string {
  const list = useCurrenciesCatalog();
  return useMemo(() => currencyByCode(list, code).symbol, [list, code]);
}

/**
 * Options for a "Currency" filter dropdown on any order list. Returns `null`
 * when the feature is dormant (fewer than 2 active currencies) so callers can
 * skip rendering the control entirely. The first option is always
 * "All currencies" (value `ALL`); the rest are `{ value: code, label }` where
 * the label pairs the symbol with the code, e.g. "₦ NGN", "GH₵ GHS".
 */
export function useCurrencyFilterOptions(): { value: string; label: string }[] | null {
  const list = useCurrenciesCatalog();
  const hasMultiple = useHasMultipleCurrencies();
  return useMemo(() => {
    if (!hasMultiple) return null;
    return [
      { value: 'ALL', label: 'All currencies' },
      ...list
        .filter((c) => c.active)
        .map((c) => ({ value: c.code, label: `${c.symbol} ${c.code}` })),
    ];
  }, [list, hasMultiple]);
}
