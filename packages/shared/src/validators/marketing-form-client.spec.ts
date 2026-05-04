import { describe, expect, it } from 'vitest';
import {
  approveFundingRequestSchema,
  createAdSpendBatchSchema,
  createAdSpendLogFormSchema,
  createFundingSchema,
} from './marketing';

describe('createAdSpendLogFormSchema', () => {
  it('accepts a valid log-ad-spend payload', () => {
    const r = createAdSpendLogFormSchema.safeParse({
      campaignId: '550e8400-e29b-41d4-a716-446655440001',
      productId: '550e8400-e29b-41d4-a716-446655440002',
      spendAmount: '15000.50',
      spendDate: '2026-04-27',
      screenshotUrl: 'https://example.com/shot.png',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.spendAmount).toBe(15000.5);
    }
  });

  it('rejects missing campaign', () => {
    const r = createAdSpendLogFormSchema.safeParse({
      productId: '550e8400-e29b-41d4-a716-446655440002',
      spendAmount: '100',
      spendDate: '2026-04-27',
      screenshotUrl: 'https://example.com/a.png',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty screenshot URL', () => {
    const r = createAdSpendLogFormSchema.safeParse({
      campaignId: '550e8400-e29b-41d4-a716-446655440001',
      productId: '550e8400-e29b-41d4-a716-446655440002',
      spendAmount: '100',
      spendDate: '2026-04-27',
      screenshotUrl: '',
    });
    expect(r.success).toBe(false);
  });

  it('requires platformCustomLabel when platform is OTHER', () => {
    const bad = createAdSpendLogFormSchema.safeParse({
      campaignId: '550e8400-e29b-41d4-a716-446655440001',
      productId: '550e8400-e29b-41d4-a716-446655440002',
      spendAmount: '100',
      spendDate: '2026-04-27',
      screenshotUrl: 'https://example.com/a.png',
      platform: 'OTHER',
    });
    expect(bad.success).toBe(false);
    const ok = createAdSpendLogFormSchema.safeParse({
      campaignId: '550e8400-e29b-41d4-a716-446655440001',
      productId: '550e8400-e29b-41d4-a716-446655440002',
      spendAmount: '100',
      spendDate: '2026-04-27',
      screenshotUrl: 'https://example.com/a.png',
      platform: 'OTHER',
      platformCustomLabel: 'Snapchat',
    });
    expect(ok.success).toBe(true);
  });
});

describe('createAdSpendBatchSchema', () => {
  const lineBase = {
    campaignId: '550e8400-e29b-41d4-a716-446655440001',
    productId: '550e8400-e29b-41d4-a716-446655440002',
    spendAmount: 100,
    screenshotUrl: 'https://example.com/a.png',
    platform: 'OTHER' as const,
  };

  it('rejects OTHER without custom label on a line', () => {
    const r = createAdSpendBatchSchema.safeParse({
      spendDate: '2026-04-27',
      lines: [{ ...lineBase }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts OTHER with platformCustomLabel', () => {
    const r = createAdSpendBatchSchema.safeParse({
      spendDate: '2026-04-27',
      lines: [{ ...lineBase, platformCustomLabel: 'Taboola' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('createFundingSchema', () => {
  it('requires receipt URL', () => {
    const bad = createFundingSchema.safeParse({
      receiverId: '550e8400-e29b-41d4-a716-446655440003',
      amount: '5000',
      receiptUrl: '',
    });
    expect(bad.success).toBe(false);
    const ok = createFundingSchema.safeParse({
      receiverId: '550e8400-e29b-41d4-a716-446655440003',
      amount: '5000',
      receiptUrl: 'https://cdn.example/r.png',
    });
    expect(ok.success).toBe(true);
  });
});

describe('approveFundingRequestSchema', () => {
  it('accepts request id, amount, and receipt URL', () => {
    const r = approveFundingRequestSchema.safeParse({
      requestId: '550e8400-e29b-41d4-a716-446655440004',
      amount: 50000,
      receiptUrl: 'https://cdn.example/r.png',
    });
    expect(r.success).toBe(true);
  });
});
