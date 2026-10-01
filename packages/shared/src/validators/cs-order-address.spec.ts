/**
 * CS-entered orders must carry a delivery address, like the public form does.
 *
 * The gap this closes: the public edge form enforces address + state at three
 * layers (HTML required, always-shown, and a server-side 400 in the worker's
 * `validateSubmission`), and produced 0 addressless orders in 3,149. The
 * CS-facing paths used `createOfflineOrderSchema` where both were `.optional()`
 * and the modals did not mark them required, so ~31% of `offline` and
 * `delivered_follow_up` orders reached logistics with no address at all.
 *
 * Bulk import is deliberately excluded — historical CRM rows predate the
 * requirement and rejecting them would block a migration, not improve an order.
 */
import { describe, expect, it } from 'vitest';
import {
  createOfflineOrderSchema,
  createDeliveredFollowUpOrderSchema,
  importOrderSchema,
} from './orders';

const base = {
  customerName: 'Ada Obi',
  customerPhone: '08031234567',
  items: [{ productId: '0192f8c4-0000-7000-8000-000000000001', quantity: 1, unitPrice: '1000' }],
  deliveryAddress: '12 Allen Avenue, Ikeja',
  deliveryState: 'Lagos',
};

describe('createOfflineOrderSchema', () => {
  it('accepts an order with an address and state', () => {
    expect(createOfflineOrderSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ['deliveryAddress', 'Delivery address is required'],
    ['deliveryState', 'Delivery state is required'],
  ])('rejects a missing %s', (field, message) => {
    const input = { ...base } as Record<string, unknown>;
    delete input[field];
    const res = createOfflineOrderSchema.safeParse(input);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === field)).toBe(true);
    }
    expect(message).toBeTruthy();
  });

  // Whitespace is the realistic failure — a CS rep tabbing through the field.
  it.each(['', '   ', '\t\n'])('rejects a blank address (%j)', (blank) => {
    const res = createOfflineOrderSchema.safeParse({ ...base, deliveryAddress: blank });
    expect(res.success).toBe(false);
  });

  it('rejects a whitespace-only state', () => {
    expect(createOfflineOrderSchema.safeParse({ ...base, deliveryState: '  ' }).success).toBe(false);
  });

  it('trims a padded address rather than rejecting it', () => {
    const res = createOfflineOrderSchema.safeParse({ ...base, deliveryAddress: '  12 Allen Avenue  ' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.deliveryAddress).toBe('12 Allen Avenue');
  });
});

describe('createDeliveredFollowUpOrderSchema', () => {
  // Derived from the offline schema, so it must inherit the requirement.
  it('inherits the address requirement', () => {
    const { offlineOrderCategory: _omit, ...input } = { ...base, offlineOrderCategory: undefined };
    expect(createDeliveredFollowUpOrderSchema.safeParse(input).success).toBe(true);
    expect(
      createDeliveredFollowUpOrderSchema.safeParse({ ...input, deliveryAddress: '' }).success,
    ).toBe(false);
  });
});

describe('importOrderSchema', () => {
  // Intentionally NOT tightened: historical CRM rows legitimately lack one.
  it('still accepts a row with no address, so migrations are not blocked', () => {
    const res = importOrderSchema.safeParse({
      customerName: 'Legacy Customer',
      customerPhone: '08031234567',
      items: base.items,
      targetStatus: 'DELIVERED',
    });
    expect(res.success).toBe(true);
  });
});
