import { buildOrderClipboardSummaryText } from '@yannis/shared';
import type { OrderDetail } from './types';

/**
 * Plain-text block for pasting (offline / tests). Prefer `fetchOrderClipboardSummary` on
 * order detail so the server can include the stored customer phone when present.
 */
export function buildOrderSummaryClipboardText(order: OrderDetail): string {
  return buildOrderClipboardSummaryText({
    id: order.id,
    status: order.status,
    customerName: order.customerName,
    customerPhoneForPaste: order.customerPhoneDisplay,
    deliveryAddress: order.deliveryAddress ?? null,
    customerAddress: order.customerAddress ?? null,
    orderItems: order.orderItems,
    totalAmount: order.totalAmount ?? null,
    preferredDeliveryDate: order.preferredDeliveryDate ?? null,
    logisticsLocationName: order.logisticsLocationName ?? null,
    paymentStatus: order.paymentStatus ?? null,
    deliveryNotes: order.deliveryNotes ?? null,
    campaignCustomFieldDefs: order.campaignCustomFieldDefs,
    customFields: order.customFields as Record<string, unknown> | null | undefined,
  });
}
