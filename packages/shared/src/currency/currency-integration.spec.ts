import { describe, it, expect } from 'vitest';
import {
  createOrderSchema,
  createOfflineOrderSchema,
  listOrdersSchema,
  createCurrencySchema,
  updateCurrencySchema,
  setFxRateSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
} from '../validators/index';

// A minimal valid order body (edge-form shape) with one item.
const baseOrder = {
  customerName: 'Ada Lovelace',
  customerPhoneHash: 'hash123',
  items: [{ productId: '018f0000-0000-7000-8000-000000000001', quantity: 1, unitPrice: 20000, offerLabel: 'Buy 2' }],
  totalAmount: 20000,
};

describe('INTAKE never-reject: createOrderSchema currencyCode is optional', () => {
  it('accepts an order with NO currencyCode (single-currency world unchanged)', () => {
    const r = createOrderSchema.safeParse(baseOrder);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currencyCode).toBeUndefined();
  });

  it('accepts an order WITH a currencyCode and uppercases it', () => {
    const r = createOrderSchema.safeParse({ ...baseOrder, currencyCode: 'ghs' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currencyCode).toBe('GHS');
  });

  it('does NOT reject a weird-but-short currency string (stamp-never-reject; API defaults later)', () => {
    // The intake must never fail on currency — only ≤5 chars is enforced.
    const r = createOrderSchema.safeParse({ ...baseOrder, currencyCode: 'ZZ' });
    expect(r.success).toBe(true);
  });

  it('still rejects a genuinely invalid order (missing name) — currency change did not weaken validation', () => {
    const { customerName: _omit, ...noName } = baseOrder;
    const r = createOrderSchema.safeParse(noName);
    expect(r.success).toBe(false);
  });
});

describe('createOfflineOrderSchema currencyCode is optional + uppercased', () => {
  const offline = {
    customerName: 'Grace Hopper',
    customerPhone: '08030000000',
    items: baseOrder.items,
    totalAmount: 20000,
  };
  it('accepts without currencyCode', () => {
    expect(createOfflineOrderSchema.safeParse(offline).success).toBe(true);
  });
  it('uppercases currencyCode', () => {
    const r = createOfflineOrderSchema.safeParse({ ...offline, currencyCode: 'ghs' });
    expect(r.success && r.data.currencyCode).toBe('GHS');
  });
});

describe('listOrdersSchema currency filter', () => {
  it('omitted currencyCode = all currencies', () => {
    const r = listOrdersSchema.safeParse({});
    expect(r.success && r.data.currencyCode).toBeUndefined();
  });
  it('a specific currency filter is uppercased', () => {
    const r = listOrdersSchema.safeParse({ currencyCode: 'ghs' });
    expect(r.success && r.data.currencyCode).toBe('GHS');
  });
});

describe('createCurrencySchema (config)', () => {
  it('accepts a valid new currency with defaults (FX rate required for non-default)', () => {
    const r = createCurrencySchema.safeParse({ code: 'ghs', symbol: 'GH₵', countryName: 'Ghana', fxRate: 240 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe('GHS'); // uppercased
      expect(r.data.precision).toBe(2); // default
      expect(r.data.isDefault).toBe(false); // default
      expect(r.data.active).toBe(true); // default
      expect(r.data.fxRate).toBe(240);
    }
  });
  it('requires an FX rate for a non-default currency', () => {
    // A non-default currency without a rate can't be converted in merged/FX
    // aggregates, so creation must reject it (the Add-currency form enforces this too).
    expect(createCurrencySchema.safeParse({ code: 'GHS', symbol: 'GH₵', countryName: 'Ghana' }).success).toBe(false);
    expect(createCurrencySchema.safeParse({ code: 'GHS', symbol: 'GH₵', countryName: 'Ghana', fxRate: 0 }).success).toBe(false);
  });
  it('does not require an FX rate for the default (base) currency', () => {
    const r = createCurrencySchema.safeParse({ code: 'NGN', symbol: '₦', countryName: 'Nigeria', isDefault: true });
    expect(r.success).toBe(true);
  });
  it('rejects a bad code (too long / non-alpha)', () => {
    expect(createCurrencySchema.safeParse({ code: 'TOOLONG', symbol: 'X', countryName: 'Y' }).success).toBe(false);
    expect(createCurrencySchema.safeParse({ code: 'G1', symbol: 'X', countryName: 'Y' }).success).toBe(false);
  });
  it('rejects an empty symbol', () => {
    expect(createCurrencySchema.safeParse({ code: 'GHS', symbol: '', countryName: 'Ghana' }).success).toBe(false);
  });
});

describe('setFxRateSchema', () => {
  it('accepts a positive rate', () => {
    expect(setFxRateSchema.safeParse({ id: '018f0000-0000-7000-8000-000000000001', fxRate: 210 }).success).toBe(true);
  });
  it('rejects a zero or negative rate', () => {
    expect(setFxRateSchema.safeParse({ id: '018f0000-0000-7000-8000-000000000001', fxRate: 0 }).success).toBe(false);
    expect(setFxRateSchema.safeParse({ id: '018f0000-0000-7000-8000-000000000001', fxRate: -5 }).success).toBe(false);
  });
});

describe('updateCurrencySchema does NOT allow editing code or isDefault (frozen integrity)', () => {
  it('drops code/isDefault (not in schema — they are immutable / dedicated op)', () => {
    const r = updateCurrencySchema.safeParse({ id: '018f0000-0000-7000-8000-000000000001', symbol: 'X', code: 'ZZZ', isDefault: true } as unknown);
    expect(r.success).toBe(true);
    if (r.success) {
      expect('code' in r.data).toBe(false);
      expect('isDefault' in r.data).toBe(false);
    }
  });
});

describe('offer template prices map', () => {
  const tpl = { productId: '018f0000-0000-7000-8000-000000000001', name: 'Buy 2', price: 20000 };
  it('accepts an offer with no prices map (single-currency)', () => {
    const r = createOfferTemplateSchema.safeParse(tpl);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.prices).toBeUndefined();
  });
  it('accepts a per-currency prices map and uppercases keys', () => {
    const r = createOfferTemplateSchema.safeParse({ ...tpl, prices: { ghs: 1500, usd: 20 } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.prices).toEqual({ GHS: 1500, USD: 20 });
    }
  });
  it('update schema accepts a prices map', () => {
    const r = updateOfferTemplateSchema.safeParse({ id: '018f0000-0000-7000-8000-000000000001', prices: { GHS: 1600 } });
    expect(r.success).toBe(true);
  });
});
