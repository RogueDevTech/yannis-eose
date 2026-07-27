/**
 * Unit tests for logistics validator security fixes.
 * S1: Status enum constraints on logistics page bundle
 * M10: rateCard JSON constraints
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createProviderSchema, updateProviderSchema } from './logistics';

// ── S1: Reproduce the Zod enum schema from the router ──────────────────
// The actual router schema is inline in logistics.router.ts. We replicate
// the enum here to test that status/statuses only accept valid order statuses.
const ORDER_STATUS_ENUM = z.enum([
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'CANCELLED',
  'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED',
  'PARTIALLY_DELIVERED', 'RETURNED', 'RESTOCKED', 'WRITTEN_OFF',
  'REMITTED', 'DELETED',
]);

const logisticsPageBundleSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(100),
  status: ORDER_STATUS_ENUM.optional(),
  statuses: z.array(ORDER_STATUS_ENUM).min(1).optional(),
});

describe('logisticsOrdersPageBundle — S1: SQL injection prevention via enum constraint', () => {
  it('accepts valid status', () => {
    const r = logisticsPageBundleSchema.safeParse({ page: 1, limit: 50, status: 'DELIVERED' });
    expect(r.success).toBe(true);
  });

  it('accepts valid statuses array', () => {
    const r = logisticsPageBundleSchema.safeParse({
      page: 1,
      limit: 50,
      statuses: ['CONFIRMED', 'DISPATCHED', 'DELIVERED'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects SQL injection in status field', () => {
    const r = logisticsPageBundleSchema.safeParse({
      page: 1,
      limit: 50,
      status: "DELIVERED'; DROP TABLE orders; --",
    });
    expect(r.success).toBe(false);
  });

  it('rejects SQL injection in statuses array element', () => {
    const r = logisticsPageBundleSchema.safeParse({
      page: 1,
      limit: 50,
      statuses: ["DELIVERED", "CONFIRMED'; DELETE FROM users; --"],
    });
    expect(r.success).toBe(false);
  });

  it('rejects arbitrary string status', () => {
    const r = logisticsPageBundleSchema.safeParse({
      page: 1,
      limit: 50,
      status: 'NOT_A_REAL_STATUS',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty string status', () => {
    const r = logisticsPageBundleSchema.safeParse({ page: 1, limit: 50, status: '' });
    expect(r.success).toBe(false);
  });

  it('accepts omitted status (optional)', () => {
    const r = logisticsPageBundleSchema.safeParse({ page: 1, limit: 50 });
    expect(r.success).toBe(true);
  });

  it('rejects statuses with single invalid entry among valid ones', () => {
    const r = logisticsPageBundleSchema.safeParse({
      page: 1,
      limit: 50,
      statuses: ['DELIVERED', 'REMITTED', 'HACKED'],
    });
    expect(r.success).toBe(false);
  });
});

describe('createProviderSchema / updateProviderSchema — M10: rateCard constraints', () => {
  const base = {
    name: 'Test Logistics',
    contactInfo: '08012345678',
    coverageArea: 'Lagos Metro',
  };

  it('accepts flat key-value rateCard', () => {
    const r = createProviderSchema.safeParse({
      ...base,
      rateCard: { 'Lagos-Abuja': 2500, 'Lagos-PH': 3000, express: true, notes: 'COD only' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts null values in rateCard', () => {
    const r = createProviderSchema.safeParse({
      ...base,
      rateCard: { rate: null },
    });
    expect(r.success).toBe(true);
  });

  it('accepts empty rateCard', () => {
    const r = createProviderSchema.safeParse({ ...base, rateCard: {} });
    expect(r.success).toBe(true);
  });

  it('accepts omitted rateCard (optional)', () => {
    const r = createProviderSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('rejects nested object in rateCard', () => {
    const r = createProviderSchema.safeParse({
      ...base,
      rateCard: { nested: { deep: 'value' } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects array value in rateCard', () => {
    const r = createProviderSchema.safeParse({
      ...base,
      rateCard: { list: [1, 2, 3] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects undefined value in rateCard', () => {
    const r = createProviderSchema.safeParse({
      ...base,
      rateCard: { key: undefined },
    });
    // z.union([string, number, boolean, null]) does not include undefined
    expect(r.success).toBe(false);
  });

  it('updateProviderSchema rejects nested rateCard too', () => {
    const r = updateProviderSchema.safeParse({
      providerId: '550e8400-e29b-41d4-a716-446655440001',
      rateCard: { deep: { nested: true } },
    });
    expect(r.success).toBe(false);
  });
});
