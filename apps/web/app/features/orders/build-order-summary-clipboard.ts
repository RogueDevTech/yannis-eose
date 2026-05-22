import { buildOrderClipboardSummaryText } from '@yannis/shared';
import type { OrderDetail } from './types';

/**
 * Plain-text block for pasting (offline / tests). Prefer `fetchOrderClipboardSummary` on
 * order detail so the server can include the stored customer phone when present.
 */
export function buildOrderSummaryClipboardText(order: OrderDetail): string {
  return buildOrderClipboardSummaryText({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    customerPhoneForPaste: order.customerPhoneDisplay,
    deliveryAddress: order.deliveryAddress ?? null,
    customerAddress: order.customerAddress ?? null,
    deliveryState: order.deliveryState ?? null,
    orderItems: order.orderItems,
    totalAmount: order.totalAmount ?? null,
    createdAt: order.createdAt ?? null,
    preferredDeliveryDate: order.preferredDeliveryDate ?? null,
    logisticsLocationName: order.logisticsLocationName ?? null,
    logisticsProviderName: order.logisticsProviderName ?? null,
    paymentStatus: order.paymentStatus ?? null,
    deliveryNotes: order.deliveryNotes ?? null,
    assignedCsName: order.assignedCsName ?? null,
    campaignCustomFieldDefs: order.campaignCustomFieldDefs,
    customFields: order.customFields as Record<string, unknown> | null | undefined,
  });
}
