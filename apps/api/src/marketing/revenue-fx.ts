/**
 * Delivered revenue → base currency (₦) for marketing ratios (ROAS, revenue
 * totals beside ₦ ad spend).
 *
 * Orders freeze their own currency, so a media buyer's delivered revenue is a
 * per-currency bag. Summing that bag 1:1 (K1,200 counted as ₦1,200) understated
 * every international delivery and broke ROAS. This converts each slice with its
 * company's `currencies.fx_rate_to_base` (1 unit of X = rate ₦), current rate,
 * reporting lens only: operational money is never converted.
 *
 * A currency with no usable rate is NOT counted 1:1 — it is returned in
 * `unconverted` so callers can surface it ("Set FX rate") instead of silently
 * mis-rating it. The same goes for every currency of a company whose base is
 * not NGN: its rates point at that base, not at ₦, so they cannot be used here.
 */

export type FxRateRow = {
  groupId: string | null;
  code: string;
  isDefault: boolean;
  fxRateToBase: string | number | null;
};

/** One grouped revenue slice: company × currency. */
export type RevenueSlice = {
  groupId: string | null;
  currencyCode: string | null;
  total: number;
};

export type FxRateLookup = (groupId: string | null, code: string) => number | null;

const BASE_CODE = 'NGN';

/** Build a rate lookup from `currencies` rows. Returns null for "cannot convert". */
export function buildFxRateLookup(rows: FxRateRow[]): FxRateLookup {
  const byKey = new Map<string, FxRateRow>();
  const baseByGroup = new Map<string, string>();
  for (const r of rows) {
    byKey.set(`${r.groupId ?? ''}:${r.code.toUpperCase()}`, r);
    if (r.isDefault) baseByGroup.set(r.groupId ?? '', r.code.toUpperCase());
  }
  return (groupId, code) => {
    const upper = code.toUpperCase();
    // `fx_rate_to_base` is relative to the company's own base. Only an NGN-based
    // company's rates convert to ₦; anything else stays unconverted.
    const groupBase = baseByGroup.get(groupId ?? '');
    if (groupBase && groupBase !== BASE_CODE) return null;
    const row = byKey.get(`${groupId ?? ''}:${upper}`);
    if (!row) {
      // No catalog row: only the legacy base currency is safe to take as-is
      // (every pre-multi-currency order is NGN with no catalog behind it).
      return upper === BASE_CODE ? 1 : null;
    }
    if (row.isDefault) return 1;
    const rate = row.fxRateToBase == null ? NaN : Number(row.fxRateToBase);
    return rate > 0 ? rate : null;
  };
}

/**
 * Convert revenue slices to base. `base` is the ₦-equivalent of every
 * convertible slice; `unconverted` holds raw amounts per currency that had no
 * rate (excluded from `base`); `invalid` lists slices whose SUM was not a
 * finite number (excluded too, callers log them).
 */
export function convertRevenueToBase(
  slices: RevenueSlice[],
  rateOf: FxRateLookup,
): { base: number; unconverted: Record<string, number>; invalid: RevenueSlice[] } {
  let base = 0;
  const unconverted: Record<string, number> = {};
  const invalid: RevenueSlice[] = [];
  for (const s of slices) {
    const amount = Number(s.total ?? 0);
    // One order with a numeric 'NaN' total_amount makes SUM() NaN for its whole
    // company × currency group. Keep it out of the total, but report it.
    if (!Number.isFinite(amount)) {
      invalid.push(s);
      continue;
    }
    if (amount === 0) continue;
    const code = (s.currencyCode ?? BASE_CODE).toUpperCase();
    const rate = rateOf(s.groupId, code);
    if (rate == null) unconverted[code] = (unconverted[code] ?? 0) + amount;
    else base += amount * rate;
  }
  return { base, unconverted, invalid };
}
