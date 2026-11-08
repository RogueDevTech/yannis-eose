import { describe, it, expect } from 'vitest';
import { baseToCurrency, buildFxRateLookup, convertRevenueToBase, revenueInCurrency, type FxRateRow } from './revenue-fx';

/**
 * Delivered revenue → ₦ for media buyer ROAS (Team Analysis ticket, Oct 2026).
 * Before: every currency was summed 1:1, so K1,200 counted as ₦1,200 and the
 * Team table showed only the NGN slice. Rates below are prod's (2B21, Sep 14).
 */
const CO = 'company-2b21';
const OTHER = 'company-other';
const rates: FxRateRow[] = [
  { groupId: CO, code: 'NGN', isDefault: true, fxRateToBase: '1.000000' },
  { groupId: CO, code: 'ZMW', isDefault: false, fxRateToBase: '70.930000' },
  { groupId: CO, code: 'KES', isDefault: false, fxRateToBase: '10.390000' },
  { groupId: CO, code: 'TZS', isDefault: false, fxRateToBase: '0.510000' },
  { groupId: CO, code: 'GHS', isDefault: false, fxRateToBase: null },
  { groupId: OTHER, code: 'NGN', isDefault: true, fxRateToBase: null },
  { groupId: OTHER, code: 'ZMW', isDefault: false, fxRateToBase: '80' },
  // A company whose base is Kwacha: its rates point at ZMW, not ₦.
  { groupId: 'company-zm', code: 'ZMW', isDefault: true, fxRateToBase: null },
  { groupId: 'company-zm', code: 'KES', isDefault: false, fxRateToBase: '0.08' },
  { groupId: 'company-zm', code: 'NGN', isDefault: false, fxRateToBase: '0.014' },
];
const rateOf = buildFxRateLookup(rates);

describe('convertRevenueToBase', () => {
  it('converts every country to ₦ (Godwin Ojochegbe Abuka, Oct 2026)', () => {
    const { base, unconverted } = convertRevenueToBase(
      [
        { groupId: CO, currencyCode: 'NGN', total: 3_060_000 },
        { groupId: CO, currencyCode: 'KES', total: 48_000 },
        { groupId: CO, currencyCode: 'TZS', total: 1_500_000 },
        { groupId: CO, currencyCode: 'ZMW', total: 82_250 },
      ],
      rateOf,
    );
    expect(base).toBeCloseTo(10_157_712.5, 2);
    expect(unconverted).toEqual({});
  });

  it('leaves Nigerian-only revenue exactly as before', () => {
    const { base } = convertRevenueToBase([{ groupId: CO, currencyCode: 'NGN', total: 4_177_000 }], rateOf);
    expect(base).toBe(4_177_000);
  });

  it('never counts a currency with no rate 1:1', () => {
    const { base, unconverted } = convertRevenueToBase(
      [
        { groupId: CO, currencyCode: 'NGN', total: 100_000 },
        { groupId: CO, currencyCode: 'GHS', total: 1_300 },
        { groupId: CO, currencyCode: 'XOF', total: 5_000 },
      ],
      rateOf,
    );
    expect(base).toBe(100_000);
    expect(unconverted).toEqual({ GHS: 1_300, XOF: 5_000 });
  });

  it("uses each company's own rate", () => {
    const { base } = convertRevenueToBase(
      [
        { groupId: CO, currencyCode: 'ZMW', total: 1_000 },
        { groupId: OTHER, currencyCode: 'ZMW', total: 1_000 },
      ],
      rateOf,
    );
    expect(base).toBeCloseTo(70_930 + 80_000, 2);
  });

  it('treats legacy NGN with no currency or catalog row as ₦', () => {
    const { base } = convertRevenueToBase(
      [
        { groupId: null, currencyCode: null, total: 50_000 },
        { groupId: 'no-catalog', currencyCode: 'NGN', total: 25_000 },
      ],
      rateOf,
    );
    expect(base).toBe(75_000);
  });

  it('never converts a company whose base is not NGN', () => {
    const { base, unconverted } = convertRevenueToBase(
      [
        { groupId: 'company-zm', currencyCode: 'ZMW', total: 100_000 },
        { groupId: 'company-zm', currencyCode: 'KES', total: 5_000 },
        { groupId: 'company-zm', currencyCode: 'NGN', total: 20_000 },
      ],
      rateOf,
    );
    expect(base).toBe(0);
    expect(unconverted).toEqual({ ZMW: 100_000, KES: 5_000, NGN: 20_000 });
  });

  it('reports a NaN SUM instead of adding it', () => {
    const { base, unconverted, invalid } = convertRevenueToBase(
      [
        { groupId: CO, currencyCode: 'NGN', total: Number.NaN },
        { groupId: CO, currencyCode: 'ZMW', total: 1_000 },
      ],
      rateOf,
    );
    expect(base).toBeCloseTo(70_930, 2);
    expect(unconverted).toEqual({});
    expect(invalid).toEqual([{ groupId: CO, currencyCode: 'NGN', total: Number.NaN }]);
  });
});

/**
 * Country filter on the MB dashboard (ticket, Nov 2026): with Zambia picked,
 * money must be in ZMW, not ₦ figures under a ₦ symbol.
 */
describe('baseToCurrency', () => {
  it('converts ₦ ad spend into the picked country (₦ / rate)', () => {
    // ZMW rate 70.93: ₦709,300 of spend = K10,000.
    expect(baseToCurrency([{ groupId: CO, total: 709_300 }], 'ZMW', rateOf)).toBeCloseTo(10_000, 6);
  });

  it('uses each company its own rate', () => {
    const out = baseToCurrency(
      [
        { groupId: CO, total: 70_930 }, // K1,000 at 70.93
        { groupId: OTHER, total: 80_000 }, // K1,000 at 80
      ],
      'ZMW',
      rateOf,
    );
    expect(out).toBeCloseTo(2_000, 6);
  });

  it('is unchanged for the base currency', () => {
    expect(baseToCurrency([{ groupId: CO, total: '1750000' }], 'NGN', rateOf)).toBe(1_750_000);
  });

  it('returns null when the country has no rate, never a ₦ number', () => {
    expect(baseToCurrency([{ groupId: CO, total: 5_000 }], 'GHS', rateOf)).toBeNull();
  });

  it('ignores empty slices, so a missing rate with no spend is not an error', () => {
    expect(baseToCurrency([{ groupId: CO, total: 0 }, { groupId: CO, total: null }], 'GHS', rateOf)).toBe(0);
  });
});

describe('revenueInCurrency', () => {
  it('sums only the picked currency, raw (no FX)', () => {
    expect(
      revenueInCurrency(
        [
          { groupId: CO, currencyCode: 'ZMW', total: 1_200 },
          { groupId: OTHER, currencyCode: 'zmw', total: 2_400 },
          { groupId: CO, currencyCode: 'TZS', total: 150_000 },
        ],
        'ZMW',
      ),
    ).toBe(3_600);
  });

  it('counts NULL currency as NGN', () => {
    expect(revenueInCurrency([{ groupId: CO, currencyCode: null, total: 60_000 }], 'NGN')).toBe(60_000);
    expect(revenueInCurrency([{ groupId: CO, currencyCode: null, total: 60_000 }], 'ZMW')).toBe(0);
  });
});
