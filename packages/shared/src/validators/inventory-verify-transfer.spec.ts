/**
 * Unit tests for verifyTransferSchema — M3: quantityReceived max validation.
 * The Zod schema allows min(0) but the server-side guard enforces <= quantitySent.
 * This test validates the schema-level constraints.
 */
import { describe, expect, it } from 'vitest';
import { verifyTransferSchema } from './inventory';

describe('verifyTransferSchema — M3: quantity bounds', () => {
  const base = {
    transferId: '550e8400-e29b-41d4-a716-446655440001',
  };

  it('accepts quantityReceived = 0 (total loss scenario)', () => {
    const r = verifyTransferSchema.safeParse({ ...base, quantityReceived: 0 });
    expect(r.success).toBe(true);
  });

  it('accepts positive quantityReceived', () => {
    const r = verifyTransferSchema.safeParse({ ...base, quantityReceived: 50 });
    expect(r.success).toBe(true);
  });

  it('rejects negative quantityReceived', () => {
    const r = verifyTransferSchema.safeParse({ ...base, quantityReceived: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer quantityReceived', () => {
    const r = verifyTransferSchema.safeParse({ ...base, quantityReceived: 10.5 });
    expect(r.success).toBe(false);
  });

  it('accepts optional shrinkageReason', () => {
    const r = verifyTransferSchema.safeParse({
      ...base,
      quantityReceived: 8,
      shrinkageReason: '2 units damaged in transit',
    });
    expect(r.success).toBe(true);
  });

  it('accepts optional receiverNotes with max 500 chars', () => {
    const r = verifyTransferSchema.safeParse({
      ...base,
      quantityReceived: 10,
      receiverNotes: 'A'.repeat(500),
    });
    expect(r.success).toBe(true);
  });

  it('rejects receiverNotes exceeding 500 chars', () => {
    const r = verifyTransferSchema.safeParse({
      ...base,
      quantityReceived: 10,
      receiverNotes: 'A'.repeat(501),
    });
    expect(r.success).toBe(false);
  });
});
