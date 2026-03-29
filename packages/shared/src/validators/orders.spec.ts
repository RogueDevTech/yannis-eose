import { describe, it, expect } from 'vitest';
import {
  createOrderSchema,
  transitionOrderSchema,
  listOrdersSchema,
  bulkReassignSchema,
  updateOrderSchema,
} from './orders';

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ---------------------------------------------------------------------------
// createOrderSchema
// ---------------------------------------------------------------------------

describe('createOrderSchema', () => {
  const baseValid = {
    customerName: 'John Doe',
    customerPhoneHash: 'abc123hashvalue',
    items: [{ productId: VALID_UUID, quantity: 1, unitPrice: 10000 }],
  };

  it('accepts minimal valid order', () => {
    expect(() => createOrderSchema.parse(baseValid)).not.toThrow();
  });

  it('rejects order with empty items array', () => {
    expect(() => createOrderSchema.parse({ ...baseValid, items: [] })).toThrow();
  });

  it('rejects order with customerName shorter than 2 chars', () => {
    expect(() => createOrderSchema.parse({ ...baseValid, customerName: 'A' })).toThrow();
  });

  it('rejects order with missing customerPhoneHash', () => {
    const { customerPhoneHash: _, ...rest } = baseValid;
    expect(() => createOrderSchema.parse(rest)).toThrow();
  });

  it('accepts PAY_ONLINE without customerEmail (email optional in schema)', () => {
    const input = { ...baseValid, paymentMethod: 'PAY_ONLINE' };
    // Schema does not enforce email required for PAY_ONLINE at Zod level — service validates
    expect(() => createOrderSchema.parse(input)).not.toThrow();
  });

  it('rejects invalid paymentMethod', () => {
    expect(() => createOrderSchema.parse({ ...baseValid, paymentMethod: 'BITCOIN' })).toThrow();
  });

  it('rejects item with quantity 0', () => {
    expect(() =>
      createOrderSchema.parse({
        ...baseValid,
        items: [{ productId: VALID_UUID, quantity: 0, unitPrice: 10000 }],
      }),
    ).toThrow();
  });

  it('rejects item with negative unitPrice', () => {
    expect(() =>
      createOrderSchema.parse({
        ...baseValid,
        items: [{ productId: VALID_UUID, quantity: 1, unitPrice: -1 }],
      }),
    ).toThrow();
  });

  it('rejects item with invalid UUID for productId', () => {
    expect(() =>
      createOrderSchema.parse({
        ...baseValid,
        items: [{ productId: 'not-a-uuid', quantity: 1, unitPrice: 100 }],
      }),
    ).toThrow();
  });

  it('coerces string unitPrice to number', () => {
    const result = createOrderSchema.parse({
      ...baseValid,
      items: [{ productId: VALID_UUID, quantity: 1, unitPrice: '10000' }],
    });
    expect(typeof result.items[0].unitPrice).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// transitionOrderSchema
// ---------------------------------------------------------------------------

describe('transitionOrderSchema', () => {
  const baseValid = {
    orderId: VALID_UUID,
    newStatus: 'CONFIRMED',
  };

  it('accepts minimal transition', () => {
    expect(() => transitionOrderSchema.parse(baseValid)).not.toThrow();
  });

  it('accepts valid OTP (4 digits)', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        newStatus: 'DELIVERED',
        metadata: { otp: '1234' },
      }),
    ).not.toThrow();
  });

  it('rejects OTP shorter than 4 digits', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { otp: '123' },
      }),
    ).toThrow();
  });

  it('rejects OTP longer than 4 digits', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { otp: '12345' },
      }),
    ).toThrow();
  });

  it('rejects OTP with non-digit characters', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { otp: '12ab' },
      }),
    ).toThrow();
  });

  it('accepts valid GPS coordinates', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { gpsLat: 6.5244, gpsLng: 3.3792 },
      }),
    ).not.toThrow();
  });

  it('rejects GPS lat below -90', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { gpsLat: -91, gpsLng: 0 },
      }),
    ).toThrow();
  });

  it('rejects GPS lat above 90', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { gpsLat: 91, gpsLng: 0 },
      }),
    ).toThrow();
  });

  it('rejects GPS lng below -180', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { gpsLat: 0, gpsLng: -181 },
      }),
    ).toThrow();
  });

  it('rejects GPS lng above 180', () => {
    expect(() =>
      transitionOrderSchema.parse({
        ...baseValid,
        metadata: { gpsLat: 0, gpsLng: 181 },
      }),
    ).toThrow();
  });

  it('rejects invalid orderId (not UUID)', () => {
    expect(() => transitionOrderSchema.parse({ orderId: 'not-a-uuid', newStatus: 'CONFIRMED' })).toThrow();
  });

  it('rejects invalid newStatus', () => {
    expect(() => transitionOrderSchema.parse({ orderId: VALID_UUID, newStatus: 'INVALID_STATUS' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// listOrdersSchema
// ---------------------------------------------------------------------------

describe('listOrdersSchema', () => {
  it('defaults page to 1 when omitted', () => {
    const result = listOrdersSchema.parse({});
    expect(result.page).toBe(1);
  });

  it('defaults limit to 20 when omitted', () => {
    const result = listOrdersSchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('rejects limit above 100', () => {
    expect(() => listOrdersSchema.parse({ limit: 101 })).toThrow();
  });

  it('accepts limit of exactly 100', () => {
    expect(() => listOrdersSchema.parse({ limit: 100 })).not.toThrow();
  });

  it('rejects page below 1', () => {
    expect(() => listOrdersSchema.parse({ page: 0 })).toThrow();
  });

  it('defaults sortBy to createdAt', () => {
    const result = listOrdersSchema.parse({});
    expect(result.sortBy).toBe('createdAt');
  });

  it('defaults sortOrder to desc', () => {
    const result = listOrdersSchema.parse({});
    expect(result.sortOrder).toBe('desc');
  });

  it('rejects invalid sortBy value', () => {
    expect(() => listOrdersSchema.parse({ sortBy: 'phone' })).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => listOrdersSchema.parse({ status: 'FAKE_STATUS' })).toThrow();
  });

  it('accepts valid date filter', () => {
    expect(() => listOrdersSchema.parse({ startDate: '2026-01-01', endDate: '2026-01-31' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkReassignSchema
// ---------------------------------------------------------------------------

describe('bulkReassignSchema', () => {
  it('accepts valid input with one order', () => {
    expect(() =>
      bulkReassignSchema.parse({
        orderIds: [VALID_UUID],
        fromAgentId: VALID_UUID,
        toAgentId: VALID_UUID,
      }),
    ).not.toThrow();
  });

  it('rejects empty orderIds array', () => {
    expect(() =>
      bulkReassignSchema.parse({
        orderIds: [],
        fromAgentId: VALID_UUID,
        toAgentId: VALID_UUID,
      }),
    ).toThrow();
  });

  it('rejects invalid UUID in orderIds', () => {
    expect(() =>
      bulkReassignSchema.parse({
        orderIds: ['not-a-uuid'],
        fromAgentId: VALID_UUID,
        toAgentId: VALID_UUID,
      }),
    ).toThrow();
  });

  it('rejects missing fromAgentId', () => {
    expect(() =>
      bulkReassignSchema.parse({
        orderIds: [VALID_UUID],
        toAgentId: VALID_UUID,
      }),
    ).toThrow();
  });
});
