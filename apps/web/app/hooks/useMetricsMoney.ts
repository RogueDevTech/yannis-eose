import { useCallback, useMemo } from 'react';
import { NGN, currencyByCode, formatMoney } from '@yannis/shared';
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';

/**
 * Money formatting for `marketing.metrics` results.
 *
 * With a country picked in the top bar, the API returns every money field
 * (ad spend, CPA, revenue) in that country's currency and sets `currencyCode`.
 * With "All countries" it returns ₦ (FX-consolidated) and `currencyCode` null.
 * `fxRateMissing` means the picked country has no FX rate, so ₦ spend could not
 * be converted: show "Set FX rate" instead of a number.
 */
export function useMetricsMoney(metrics?: { currencyCode?: string | null; fxRateMissing?: boolean } | null) {
  const catalog = useCurrenciesCatalog();
  const code = metrics?.currencyCode?.toUpperCase() || null;
  const currency = useMemo(() => (code ? currencyByCode(catalog, code) : NGN), [catalog, code]);
  const fmt = useCallback((amount: number) => formatMoney(Math.round(amount), currency), [currency]);
  return { code, fxRateMissing: metrics?.fxRateMissing === true, fmt };
}

/** Shown in place of spend, CPA or ROAS when the picked country has no FX rate. */
export const NO_FX_RATE_LABEL = 'Set FX rate';
