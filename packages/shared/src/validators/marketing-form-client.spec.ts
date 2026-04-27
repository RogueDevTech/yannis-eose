import { describe, expect, it } from 'vitest';
import {
  approveFundingRequestSchema,
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
  it('accepts request id and receipt URL', () => {
    const r = approveFundingRequestSchema.safeParse({
      requestId: '550e8400-e29b-41d4-a716-446655440004',
      receiptUrl: 'https://cdn.example/r.png',
    });
    expect(r.success).toBe(true);
  });
});
