/**
 * African countries + their national currencies. Powers the "Add currency"
 * config dropdown: pick a Country → the Currency code + Symbol auto-fill.
 *
 * Focused on Africa first (owner directive). `code` is ISO 4217, `symbol` the
 * common display symbol, `precision` the standard minor-unit count.
 */
export interface CountryCurrency {
  /** Country name (label + stored `country_name`). */
  country: string;
  /** ISO 4217 currency code, e.g. 'NGN', 'GHS'. */
  code: string;
  /** Display symbol, e.g. '₦', 'GH₵'. */
  symbol: string;
  /** Minor-unit decimal places. */
  precision: number;
}

export const AFRICAN_COUNTRY_CURRENCIES: ReadonlyArray<CountryCurrency> = [
  { country: 'Nigeria', code: 'NGN', symbol: '₦', precision: 2 },
  { country: 'Ghana', code: 'GHS', symbol: 'GH₵', precision: 2 },
  { country: 'Kenya', code: 'KES', symbol: 'KSh', precision: 2 },
  { country: 'Tanzania', code: 'TZS', symbol: 'TSh', precision: 2 },
  { country: 'Uganda', code: 'UGX', symbol: 'USh', precision: 0 },
  { country: 'South Africa', code: 'ZAR', symbol: 'R', precision: 2 },
  { country: 'Egypt', code: 'EGP', symbol: 'E£', precision: 2 },
  { country: 'Morocco', code: 'MAD', symbol: 'DH', precision: 2 },
  { country: 'Rwanda', code: 'RWF', symbol: 'FRw', precision: 0 },
  { country: 'Ethiopia', code: 'ETB', symbol: 'Br', precision: 2 },
  { country: 'Zambia', code: 'ZMW', symbol: 'ZK', precision: 2 },
  { country: 'Zimbabwe', code: 'ZWL', symbol: 'Z$', precision: 2 },
  { country: 'Botswana', code: 'BWP', symbol: 'P', precision: 2 },
  { country: 'Namibia', code: 'NAD', symbol: 'N$', precision: 2 },
  { country: 'Mozambique', code: 'MZN', symbol: 'MT', precision: 2 },
  { country: 'Angola', code: 'AOA', symbol: 'Kz', precision: 2 },
  { country: 'Malawi', code: 'MWK', symbol: 'MK', precision: 2 },
  { country: 'Sierra Leone', code: 'SLE', symbol: 'Le', precision: 2 },
  { country: 'Liberia', code: 'LRD', symbol: 'L$', precision: 2 },
  { country: 'Gambia', code: 'GMD', symbol: 'D', precision: 2 },
  { country: 'Tunisia', code: 'TND', symbol: 'DT', precision: 3 },
  { country: 'Algeria', code: 'DZD', symbol: 'DA', precision: 2 },
  { country: "Côte d'Ivoire (West Africa CFA)", code: 'XOF', symbol: 'CFA', precision: 0 },
  { country: 'Senegal (West Africa CFA)', code: 'XOF', symbol: 'CFA', precision: 0 },
  { country: 'Cameroon (Central Africa CFA)', code: 'XAF', symbol: 'FCFA', precision: 0 },
];

/** Distinct currency codes across the catalog (deduped, for a currency dropdown). */
export const AFRICAN_CURRENCY_CODES: ReadonlyArray<{ code: string; symbol: string; precision: number }> = (() => {
  const seen = new Map<string, { code: string; symbol: string; precision: number }>();
  for (const c of AFRICAN_COUNTRY_CURRENCIES) {
    if (!seen.has(c.code)) seen.set(c.code, { code: c.code, symbol: c.symbol, precision: c.precision });
  }
  return [...seen.values()];
})();

/** Look up the default currency for a country name. */
export function currencyForCountry(country: string): CountryCurrency | undefined {
  return AFRICAN_COUNTRY_CURRENCIES.find((c) => c.country === country);
}
