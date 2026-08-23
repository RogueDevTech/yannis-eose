/**
 * Country flag emoji for the multi-country switcher / pickers.
 *
 * The currency config carries a currency `code` (ISO 4217) and a `country_name`
 * label, but NO ISO-3166 country code. Flags need the 2-letter country code, so
 * we map currency code → ISO-2, then ISO-2 → a flag emoji built from Unicode
 * regional-indicator symbols (🇳🇬 = U+1F1F3 U+1F1EC).
 *
 * Covers the African-first catalog (`AFRICAN_COUNTRY_CURRENCIES`). Unknown codes
 * return '' (callers render just the country name), so this never throws or shows
 * a broken glyph.
 */

/** Currency code (ISO 4217) → country code (ISO 3166-1 alpha-2). */
const CURRENCY_TO_ISO2: Readonly<Record<string, string>> = {
  NGN: 'NG',
  GHS: 'GH',
  KES: 'KE',
  TZS: 'TZ',
  UGX: 'UG',
  ZAR: 'ZA',
  EGP: 'EG',
  MAD: 'MA',
  RWF: 'RW',
  ETB: 'ET',
  ZMW: 'ZM',
  ZWL: 'ZW',
  BWP: 'BW',
  NAD: 'NA',
  MZN: 'MZ',
  AOA: 'AO',
  MWK: 'MW',
  SLE: 'SL',
  LRD: 'LR',
  GMD: 'GM',
  TND: 'TN',
  DZD: 'DZ',
  // CFA franc zones span multiple countries — no single flag. Left unmapped so
  // callers fall back to the country name.
};

/** Build a flag emoji from a 2-letter ISO-3166 country code. */
function iso2ToFlag(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return '';
  const A = 0x1f1e6; // regional indicator 'A'
  const up = iso2.toUpperCase();
  return String.fromCodePoint(A + (up.charCodeAt(0) - 65), A + (up.charCodeAt(1) - 65));
}

/**
 * Flag emoji for a currency code (e.g. 'NGN' → '🇳🇬'). Returns '' for unknown /
 * multi-country currencies (XOF/XAF) so the UI just shows the country name.
 */
export function flagForCurrencyCode(code: string | null | undefined): string {
  if (!code) return '';
  const iso2 = CURRENCY_TO_ISO2[code.toUpperCase()];
  return iso2 ? iso2ToFlag(iso2) : '';
}
