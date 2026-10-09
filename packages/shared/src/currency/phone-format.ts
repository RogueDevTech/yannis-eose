import {
  AFRICAN_COUNTRY_CURRENCIES,
  COUNTRY_NUMBER_SPECS,
  type CountryNumberSpec,
} from './african-countries';

/**
 * Country-aware customer phone formatting, keyed off the ORDER's currency code
 * (orders / cart_orders / follow_up_orders `currency_code` = order country).
 *
 * READ-TIME ONLY. These helpers never feed `normalizePhoneForHash` and the stored
 * `customer_phone` is never rewritten: changing stored digits would change the
 * phone hash and break dedup, cart-order matching and cross-funnel blocking.
 *
 * Conversion rules (never guesses; unknown shapes come back as stored):
 *   '+…' or bare dial code + national length  → already international, add '+' only
 *   '0' + national length                     → drop the trunk 0, prepend dial code
 *   national length, no 0                     → prepend dial code
 *   anything else                             → null (caller shows the raw value)
 */

export interface InternationalPhone {
  /** E.164, no spaces: '+255976372552'. For tel:, wa.me, sms:, VOIP, exports. */
  e164: string;
  /** Grouped for reading: '+255 976 372 552'. */
  display: string;
  dialCode: string;
  /** National significant number, no trunk 0: '976372552'. */
  national: string;
  /**
   * False when the number has the right length for the order's country but its
   * leading digits are not a known mobile prefix there (e.g. a Zambian '097…'
   * on a Tanzania order). The CS UI shows a "check number" hint.
   */
  prefixMatchesCountry: boolean;
}

/**
 * Number spec for an order currency. Only resolves when the currency belongs to
 * exactly ONE curated country: shared currencies (XOF, XAF) span several dial
 * codes, so a local '0…' number on such an order cannot be expanded safely.
 */
export function phoneSpecForCurrency(
  currencyCode: string | null | undefined,
): CountryNumberSpec | null {
  const code = (currencyCode ?? '').trim().toUpperCase();
  if (!code) return null;
  return SPEC_BY_CURRENCY.get(code) ?? null;
}

/** Built once: currency → spec, or null when the currency spans several dial codes. */
const SPEC_BY_CURRENCY: ReadonlyMap<string, CountryNumberSpec | null> = (() => {
  const byCode = new Map<string, CountryNumberSpec[]>();
  for (const c of AFRICAN_COUNTRY_CURRENCIES) {
    const spec = COUNTRY_NUMBER_SPECS[c.country];
    if (!spec) continue;
    const code = c.code.toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), spec]);
  }
  const out = new Map<string, CountryNumberSpec | null>();
  for (const [code, specs] of byCode) {
    out.set(code, new Set(specs.map((s) => s.dial)).size === 1 ? specs[0]! : null);
  }
  return out;
})();

/**
 * Display-only overrides per dial code. NOT `COUNTRY_NUMBER_SPECS`: that table
 * also drives the frozen edge form's client-side phone check, so narrowing a
 * prefix there would block real customers. These only change how a stored
 * number reads on screen and whether CS sees the "Check number" hint.
 *
 * - `groups`         national digit grouping, the way the country writes it.
 * - `mobilePrefixes` real mobile ranges for the hint (spec prefixes are looser).
 */
const DISPLAY_OVERRIDES: Readonly<
  Record<string, { groups?: ReadonlyArray<number>; mobilePrefixes?: ReadonlyArray<string> }>
> = {
  // Ghana: '+233 24 123 4567'. 021 (old Accra landline) is not a mobile range.
  '233': {
    groups: [2, 3, 4],
    mobilePrefixes: ['20', '23', '24', '25', '26', '27', '28', '50', '53', '54', '55', '56', '57', '59'],
  },
};

/** Split by fixed group sizes; any leftover digits form a last group. */
function groupBySizes(national: string, sizes: ReadonlyArray<number>): string {
  const groups: string[] = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= national.length) break;
    groups.push(national.slice(i, i + size));
    i += size;
  }
  if (i < national.length) groups.push(national.slice(i));
  return groups.join(' ');
}

/** '976372552' → '976 372 552'; groups of 3 from the left, tail of 1 merges back. */
function groupNational(national: string): string {
  const groups = national.match(/.{1,3}/g) ?? [national];
  if (groups.length > 1 && groups[groups.length - 1]!.length === 1) {
    const tail = groups.pop()!;
    groups[groups.length - 1] += tail;
  }
  return groups.join(' ');
}

/**
 * Parse a stored customer phone into international form for the order's country.
 * Returns null when the currency has no single curated spec or the digits do not
 * fit that country's numbering length (caller falls back to the raw value).
 */
export function toInternationalPhone(
  raw: string | null | undefined,
  currencyCode: string | null | undefined,
): InternationalPhone | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const spec = phoneSpecForCurrency(currencyCode);
  if (!spec) return null;

  let digits = trimmed.replace(/\D/g, '');
  // '00255…' international dialling prefix.
  if (digits.startsWith('00')) digits = digits.slice(2);

  let national: string | null = null;
  if (digits.startsWith(spec.dial) && digits.length === spec.dial.length + spec.len) {
    national = digits.slice(spec.dial.length);
  } else if (digits.startsWith('0') && digits.length === spec.len + 1) {
    national = digits.slice(1);
  } else if (!trimmed.startsWith('+') && !digits.startsWith('0') && digits.length === spec.len) {
    national = digits;
  }
  if (!national) return null;

  const override = DISPLAY_OVERRIDES[spec.dial];
  const grouped = override?.groups ? groupBySizes(national, override.groups) : groupNational(national);
  const mobilePrefixes = override?.mobilePrefixes ?? spec.prefixes;
  return {
    e164: `+${spec.dial}${national}`,
    display: `+${spec.dial} ${grouped}`,
    dialCode: spec.dial,
    national,
    prefixMatchesCountry: mobilePrefixes.some((p) => national!.startsWith(p)),
  };
}

/** E.164 for dialing / WhatsApp / exports; falls back to the trimmed raw value. */
export function toDialablePhone(
  raw: string | null | undefined,
  currencyCode: string | null | undefined,
): string {
  return toInternationalPhone(raw, currencyCode)?.e164 ?? (raw ?? '').trim();
}

/** Grouped international display; falls back to the trimmed raw value. */
export function formatInternationalPhone(
  raw: string | null | undefined,
  currencyCode: string | null | undefined,
): string {
  return toInternationalPhone(raw, currencyCode)?.display ?? (raw ?? '').trim();
}

/**
 * Revealed customer phone for CS dial / copy / WhatsApp. `phone` is E.164 for the
 * order's country when the stored number fits it (else the stored value as-is);
 * `display` is the on-screen form. Stored digits are never rewritten.
 */
export type CallablePhone = {
  phone: string;
  isDialable: boolean;
  display?: string;
  /** True when the number fits the country's length but not its mobile prefixes. */
  prefixMismatch?: boolean;
};
