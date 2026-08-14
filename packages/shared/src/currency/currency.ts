/**
 * Pure currency helpers — shared across API and web.
 *
 * The multi-currency feature is DORMANT until a group has a 2nd ACTIVE currency.
 * Everything here is a no-op / NGN-default when only one currency exists, so
 * callers can adopt it unconditionally without changing today's behaviour.
 */

/** A currency config row, trimmed to what UI/formatting needs. */
export interface CurrencyInfo {
  code: string;
  symbol: string;
  countryName: string;
  precision: number;
  isDefault: boolean;
  active: boolean;
  /** 1 unit of THIS currency = fxRateToBase units of the base currency. NULL = unset. */
  fxRateToBase: number | null;
}

/** The hard-coded fallback when no currency config has loaded (pre-config / legacy). */
export const NGN: CurrencyInfo = {
  code: 'NGN',
  symbol: '₦', // ₦
  countryName: 'Nigeria',
  precision: 2,
  isDefault: true,
  active: true,
  fxRateToBase: 1,
};

/**
 * The master gate. TRUE only when a group has 2+ ACTIVE currencies — i.e. an
 * admin has actually added a second one. When false, EVERY multi-currency UI
 * surface (dropdowns, filters, form toggle, per-currency tiles) must stay hidden
 * and behaviour is byte-for-byte identical to the single-NGN world.
 */
export function hasMultipleCurrencies(currencies: Pick<CurrencyInfo, 'active'>[]): boolean {
  return currencies.filter((c) => c.active).length > 1;
}

/** The base (default) currency from a list, or NGN if none is marked. */
export function baseCurrency(currencies: CurrencyInfo[]): CurrencyInfo {
  return currencies.find((c) => c.isDefault && c.active) ?? currencies.find((c) => c.isDefault) ?? NGN;
}

/** Look up a currency by code, falling back to NGN. Case-insensitive on code. */
export function currencyByCode(currencies: CurrencyInfo[], code: string | null | undefined): CurrencyInfo {
  if (!code) return baseCurrency(currencies);
  const up = code.toUpperCase();
  return currencies.find((c) => c.code.toUpperCase() === up) ?? { ...NGN, code: up, symbol: up + ' ' };
}

/**
 * Format an amount in a given currency with correct sign placement.
 * Negative renders as -GH₵6,398 (minus before symbol). Mirrors the legacy
 * formatNaira output exactly for NGN so nothing shifts today.
 */
export function formatMoney(
  amount: number,
  currency?: Pick<CurrencyInfo, 'symbol' | 'precision'> | null,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const symbol = currency?.symbol ?? NGN.symbol;
  // Default to 0 fraction digits (matches legacy formatNaira), NOT the currency's
  // precision — precision governs data entry/storage, not glance-value display.
  const frac = options?.maximumFractionDigits ?? options?.minimumFractionDigits ?? 0;
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: options?.minimumFractionDigits ?? frac,
    maximumFractionDigits: options?.maximumFractionDigits ?? frac,
  };
  const formatted = Math.abs(amount).toLocaleString('en-US', opts);
  return amount < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}

/** Format by currency code against a loaded list (convenience for UI). */
export function formatMoneyByCode(
  amount: number,
  currencies: CurrencyInfo[],
  code: string | null | undefined,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  return formatMoney(amount, currencyByCode(currencies, code), options);
}

/**
 * Convert an amount from a currency INTO the base currency, using its FX rate.
 * FOR RATIO/REPORTING USE ONLY — never write the result back as operational
 * money. Returns null when the rate is unset (caller shows "Set FX rate").
 */
export function toBaseAmount(amount: number, currency: Pick<CurrencyInfo, 'fxRateToBase' | 'isDefault'>): number | null {
  if (currency.isDefault) return amount; // base → base
  if (currency.fxRateToBase == null || !(currency.fxRateToBase > 0)) return null;
  return amount * currency.fxRateToBase;
}

/**
 * A per-currency money bag. Aggregates NEVER collapse across currencies into one
 * number (Data Consistency rule: never sum ₦ + GH₵). This is the canonical
 * return shape for any money total that can span currencies.
 */
export type MoneyByCurrency = Record<string, number>;

/** Add an amount into a per-currency bag (mutates + returns for chaining). */
export function addToBag(bag: MoneyByCurrency, code: string, amount: number): MoneyByCurrency {
  const key = (code || NGN.code).toUpperCase();
  bag[key] = (bag[key] ?? 0) + amount;
  return bag;
}

/**
 * Whether a currency uses the Nigerian statutory PAYE engine (bands, rent relief,
 * exemptions). ONLY NGN does. A non-NGN payroll batch pays flat (no Nigerian PAYE)
 * until a per-country tax engine exists — this guards the in-flight PAYE-corrections
 * work from being wrongly applied to e.g. Ghanaian salaries.
 *
 * Absent/blank currency → treated as NGN (dormant/single-currency default).
 */
export function isNigerianTaxCurrency(code: string | null | undefined): boolean {
  return (code || NGN.code).toUpperCase() === NGN.code;
}
