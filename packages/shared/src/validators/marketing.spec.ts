import { describe, it, expect } from 'vitest';
import { rejectAdSpendSchema, updateAdSpendSchema } from './marketing';

const ID_A = '550e8400-e29b-41d4-a716-446655440001';
const ID_B = '550e8400-e29b-41d4-a716-446655440002';
const ID_C = '550e8400-e29b-41d4-a716-446655440003';

describe('rejectAdSpendSchema', () => {
  it('accepts id only', () => {
    const r = rejectAdSpendSchema.safeParse({ adSpendId: ID_A });
    expect(r.success).toBe(true);
  });

  it('accepts optional reason within max length', () => {
    const r = rejectAdSpendSchema.safeParse({
      adSpendId: ID_A,
      reason: 'a'.repeat(500),
    });
    expect(r.success).toBe(true);
  });

  it('rejects reason over 500 chars', () => {
    const r = rejectAdSpendSchema.safeParse({
      adSpendId: ID_A,
      reason: 'a'.repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe('updateAdSpendSchema', () => {
  const base = {
    adSpendId: ID_A,
    spendAmount: 100.5,
    screenshotUrl: 'https://example.com/shot.png',
    spendDate: '2026-04-01',
    productId: ID_B,
    campaignId: ID_C,
  };

  it('parses full payload', () => {
    const r = updateAdSpendSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.spendAmount).toBe(100.5);
    }
  });

  it('allows omitting optional campaign/product', () => {
    const r = updateAdSpendSchema.safeParse({
      adSpendId: base.adSpendId,
      spendAmount: 1,
      screenshotUrl: 'https://example.com/x.png',
      spendDate: '2026-04-01',
    });
    expect(r.success).toBe(true);
  });
});
