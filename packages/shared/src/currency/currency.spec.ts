import { describe, it, expect } from 'vitest';
import {
  NGN,
  CurrencyInfo,
  hasMultipleCurrencies,
  baseCurrency,
  currencyByCode,
  formatMoney,
  formatMoneyByCode,
  toBaseAmount,
  addToBag,
  isNigerianTaxCurrency,
} from './currency';

const ghs: CurrencyInfo = {
  code: 'GHS', symbol: 'GH₵', countryName: 'Ghana', precision: 2,
  isDefault: false, active: true, fxRateToBase: 210,
};
const ghsUnset: CurrencyInfo = { ...ghs, fxRateToBase: null };
const list = [NGN, ghs];

describe('hasMultipleCurrencies (the dormancy gate)', () => {
  it('is false with only the default currency', () => {
    expect(hasMultipleCurrencies([NGN])).toBe(false);
  });
  it('is false when the 2nd currency is inactive', () => {
    expect(hasMultipleCurrencies([NGN, { ...ghs, active: false }])).toBe(false);
  });
  it('is true with 2+ active currencies', () => {
    expect(hasMultipleCurrencies(list)).toBe(true);
  });
  it('is false for an empty list (pre-config)', () => {
    expect(hasMultipleCurrencies([])).toBe(false);
  });
  it('is false when the same code repeats across companies (group-scoped dup rows)', () => {
    // A single-country org spanning multiple companies has one NGN row per
    // company. That is still ONE currency — the feature must stay dormant.
    expect(hasMultipleCurrencies([NGN, { ...NGN }, { ...NGN }])).toBe(false);
  });
  it('counts distinct codes, not rows', () => {
    // Duplicate NGN rows + a single real GHS row = two distinct currencies.
    expect(hasMultipleCurrencies([NGN, { ...NGN }, ghs, { ...ghs }])).toBe(true);
  });
});

describe('baseCurrency', () => {
  it('returns the active default', () => {
    expect(baseCurrency(list).code).toBe('NGN');
  });
  it('falls back to NGN when nothing is default', () => {
    expect(baseCurrency([ghs]).code).toBe('NGN');
  });
});

describe('currencyByCode', () => {
  it('finds by code case-insensitively', () => {
    expect(currencyByCode(list, 'ghs').symbol).toBe('GH₵');
  });
  it('falls back to base when code is null', () => {
    expect(currencyByCode(list, null).code).toBe('NGN');
  });
});

describe('formatMoney (NGN parity with legacy formatNaira)', () => {
  it('formats NGN identically to legacy: ₦1,000,000', () => {
    expect(formatMoney(1_000_000, NGN)).toBe('₦1,000,000');
  });
  it('places minus before the symbol', () => {
    expect(formatMoney(-6_398_626, NGN)).toBe('-₦6,398,626');
  });
  it('defaults to 0 fraction digits like the legacy formatter', () => {
    expect(formatMoney(1234.56, NGN)).toBe('₦1,235');
  });
  it('honours explicit fraction digits (min mirrors max, matching legacy formatNaira)', () => {
    expect(formatMoney(1234.5, NGN, { maximumFractionDigits: 2 })).toBe('₦1,234.50');
  });
  it('uses the currency symbol for non-NGN', () => {
    expect(formatMoney(1500, ghs)).toBe('GH₵1,500');
  });
  it('falls back to ₦ when currency is null', () => {
    expect(formatMoney(10, null)).toBe('₦10');
  });
  it('formatMoneyByCode resolves symbol from the list', () => {
    expect(formatMoneyByCode(1500, list, 'GHS')).toBe('GH₵1,500');
  });
});

describe('toBaseAmount (FX ratio lens only)', () => {
  it('is identity for the base currency', () => {
    expect(toBaseAmount(500, NGN)).toBe(500);
  });
  it('multiplies by the rate for a foreign currency', () => {
    expect(toBaseAmount(1000, ghs)).toBe(210_000);
  });
  it('returns null when the rate is unset (shows "Set FX rate")', () => {
    expect(toBaseAmount(1000, ghsUnset)).toBeNull();
  });
  it('returns null for a non-positive rate', () => {
    expect(toBaseAmount(1000, { ...ghs, fxRateToBase: 0 })).toBeNull();
  });
});

describe('isNigerianTaxCurrency (PAYE bypass guard)', () => {
  it('is true for NGN', () => {
    expect(isNigerianTaxCurrency('NGN')).toBe(true);
  });
  it('is true for lowercase ngn', () => {
    expect(isNigerianTaxCurrency('ngn')).toBe(true);
  });
  it('is true for absent/blank (dormant default)', () => {
    expect(isNigerianTaxCurrency(null)).toBe(true);
    expect(isNigerianTaxCurrency(undefined)).toBe(true);
    expect(isNigerianTaxCurrency('')).toBe(true);
  });
  it('is false for GHS (flat pay, no Nigerian PAYE)', () => {
    expect(isNigerianTaxCurrency('GHS')).toBe(false);
  });
});

describe('addToBag (per-currency aggregation, never summed across)', () => {
  it('keeps currencies separate', () => {
    const bag = {};
    addToBag(bag, 'NGN', 1000);
    addToBag(bag, 'GHS', 500);
    addToBag(bag, 'NGN', 250);
    expect(bag).toEqual({ NGN: 1250, GHS: 500 });
  });
  it('normalises code case and empty to NGN', () => {
    const bag = {};
    addToBag(bag, 'ghs', 5);
    addToBag(bag, '', 10);
    expect(bag).toEqual({ GHS: 5, NGN: 10 });
  });
});
