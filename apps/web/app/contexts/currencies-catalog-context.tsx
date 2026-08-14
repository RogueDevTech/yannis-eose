import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { type CurrencyInfo, NGN, hasMultipleCurrencies as sharedHasMultiple } from '@yannis/shared';

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
