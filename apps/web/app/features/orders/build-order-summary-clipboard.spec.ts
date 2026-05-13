import { describe, it, expect } from 'vitest';
import { buildOrderSummaryClipboardText } from './build-order-summary-clipboard';
import type { OrderDetail } from './types';

function minimalOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: '025f2465-177c-4745-bd14-18bbd068b4d1',
    customerName: 'Ada O.',
    customerPhoneDisplay: '0803****4567',
    customerAddress: '12 Allen Ave',
    deliveryAddress: '45 Admiralty Way, Lekki',
    deliveryNotes: null,
    status: 'CONFIRMED',
    totalAmount: '15000',
    createdAt: '2026-03-25T21:55:00.000Z',
    confirmedAt: '2026-03-25T22:00:00.000Z',
    allocatedAt: null,
    dispatchedAt: null,
    deliveredAt: null,
    assignedCsId: null,
    orderItems: [
      {
        id: 'item-1',
        productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        quantity: 2,
        unitPrice: '7500',
        productName: 'Widget Pro',
      },
    ],
    callLogs: [],
    allowedTransitions: [],
    logisticsLocationName: 'SwiftDeliver Lekki Hub',
    ...over,
  };
}

describe('buildOrderSummaryClipboardText', () => {
  it('includes order id, masked phone, and line item', () => {
    const text = buildOrderSummaryClipboardText(minimalOrder());
    expect(text).toContain('025f2465-177c-4745-bd14-18bbd068b4d1');
    expect(text).toContain('Phone:');
    expect(text).toContain('0803****4567');
    expect(text).toContain('Widget Pro');
    expect(text).toContain('CONFIRMED');
    expect(text).toContain('SwiftDeliver Lekki Hub');
    expect(text).not.toMatch(/deliveryOtp|OTP/i);
  });

  it('includes custom field labels when defs and values exist', () => {
    const order = minimalOrder({
      campaignCustomFieldDefs: [
        { id: 'f1', type: 'text', label: 'Gate code', order: 0 },
      ],
      customFields: { f1: 'B12' },
    });
    const text = buildOrderSummaryClipboardText(order);
    expect(text).toContain('Gate code:');
    expect(text).toContain('B12');
  });
});
