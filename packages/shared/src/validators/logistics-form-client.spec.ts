import { describe, expect, it } from 'vitest';
import { createDeliveryRemittanceSchema, createRemittanceSchema } from './logistics';

describe('createRemittanceSchema', () => {
  it('accepts valid transfer remittance payload', () => {
    const r = createRemittanceSchema.safeParse({
      productId: '550e8400-e29b-41d4-a716-446655440001',
      toLocationId: '550e8400-e29b-41d4-a716-446655440002',
      quantitySent: 10,
      receiptUrl: 'https://cdn.example/r.pdf',
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing receipt URL', () => {
    const r = createRemittanceSchema.safeParse({
      productId: '550e8400-e29b-41d4-a716-446655440001',
      toLocationId: '550e8400-e29b-41d4-a716-446655440002',
      quantitySent: 5,
      receiptUrl: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('createDeliveryRemittanceSchema', () => {
  it('requires at least one order and one receipt URL', () => {
    const bad = createDeliveryRemittanceSchema.safeParse({
      orderIds: [],
      receiptUrls: ['https://a.com/1.png'],
    });
    expect(bad.success).toBe(false);
    const ok = createDeliveryRemittanceSchema.safeParse({
      orderIds: ['550e8400-e29b-41d4-a716-446655440010'],
      receiptUrls: ['https://a.com/1.png'],
    });
    expect(ok.success).toBe(true);
  });
});
