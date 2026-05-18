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
  // Batch payload now requires a top-level `campaignId` (one form per batch)
  // and each line carries an `attributedOrderCount` for the manual split.
  // CEO directive 2026-05-10: ad URL is the required evidence; screenshot is
  // optional. Keep the fixture aligned with createAdSpendBatchObjectSchema.
  const batchBase = {
    spendDate: '2026-04-27',
    campaignId: '550e8400-e29b-41d4-a716-446655440001',
  };
  const lineBase = {
    productId: '550e8400-e29b-41d4-a716-446655440002',
    spendAmount: 100,
    attributedOrderCount: 0,
    adUrl: 'https://example.com/ad',
    platform: 'OTHER' as const,
  };

  it('rejects OTHER without custom label on a line', () => {
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [{ ...lineBase }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts OTHER with platformCustomLabel', () => {
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [{ ...lineBase, platformCustomLabel: 'Taboola' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a line without screenshotUrl (screenshot is optional)', () => {
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [
        { ...lineBase, platform: 'FACEBOOK' as const, platformCustomLabel: undefined },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a line with a screenshotUrl when one is provided', () => {
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [
        {
          ...lineBase,
          platform: 'FACEBOOK' as const,
          platformCustomLabel: undefined,
          screenshotUrl: 'https://example.com/a.png',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a line without adUrl (ad URL is required)', () => {
    const { adUrl: _adUrl, ...lineWithoutAdUrl } = lineBase;
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [
        {
          ...lineWithoutAdUrl,
          platform: 'FACEBOOK' as const,
          platformCustomLabel: undefined,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a line with a non-URL adUrl', () => {
    const r = createAdSpendBatchSchema.safeParse({
      ...batchBase,
      lines: [
        {
          ...lineBase,
          platform: 'FACEBOOK' as const,
          platformCustomLabel: undefined,
          adUrl: 'not-a-url',
        },
      ],
    });
    expect(r.success).toBe(false);
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
