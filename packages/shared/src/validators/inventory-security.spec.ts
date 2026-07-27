/**
 * Unit tests for inventory validator security fixes.
 * Validates Zod schemas reject malicious / out-of-range input.
 */
import { describe, expect, it } from 'vitest';
import { stockAdjustmentSchema } from './inventory';

describe('stockAdjustmentSchema — M4: adjustment guardrails', () => {
  const base = {
    productId: '550e8400-e29b-41d4-a716-446655440001',
    locationId: '550e8400-e29b-41d4-a716-446655440002',
    reason: 'Physical count reconciliation after audit',
  };

  it('accepts adjustment within bounds (+500)', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: 500 });
    expect(r.success).toBe(true);
  });

  it('accepts adjustment within bounds (-500)', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: -500 });
    expect(r.success).toBe(true);
  });

  it('accepts max boundary (+10000)', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: 10000 });
    expect(r.success).toBe(true);
  });

  it('accepts min boundary (-10000)', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: -10000 });
    expect(r.success).toBe(true);
  });

  it('rejects adjustment above +10000', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: 10001 });
    expect(r.success).toBe(false);
  });

  it('rejects adjustment below -10000', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: -10001 });
    expect(r.success).toBe(false);
  });

  it('rejects massive positive inflation attempt', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: 999999 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer quantity', () => {
    const r = stockAdjustmentSchema.safeParse({ ...base, adjustmentQuantity: 5.5 });
    expect(r.success).toBe(false);
  });

  it('rejects short reason (min 10 chars)', () => {
    const r = stockAdjustmentSchema.safeParse({
      ...base,
      adjustmentQuantity: 1,
      reason: 'short',
    });
    expect(r.success).toBe(false);
  });
});
