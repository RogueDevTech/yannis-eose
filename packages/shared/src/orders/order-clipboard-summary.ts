/**
 * Plain-text order summary for WhatsApp / logistics handoff.
 * Used by the API (full phone when stored) and the web (digit-mask / Hidden fallback).
 */

import { formatOrderNumber } from './format-order-number';

const NOTES_MAX = 300;
const CUSTOM_VALUE_MAX = 500;

export type OrderClipboardSummaryOrderItem = {
  productName?: string | null;
  productId: string;
  quantity: number;
  unitPrice: string | number | null;
};

export type OrderClipboardSummaryCustomFieldDef = {
  id: string;
  type: string;
  label: string;
  order: number;
  options?: string[];
};

export type OrderClipboardSummaryInput = {
  id: string;
  orderNumber?: number | null;
  status: string;
  customerName: string;
  /** Full number or a short explanation when the number is not on file. */
  customerPhoneForPaste: string;
  deliveryAddress?: string | null;
  customerAddress?: string | null;
  deliveryState?: string | null;
  orderItems?: OrderClipboardSummaryOrderItem[];
  totalAmount?: string | null;
  createdAt?: string | null;
  preferredDeliveryDate?: string | null;
  logisticsLocationName?: string | null;
  logisticsProviderName?: string | null;
  paymentStatus?: string | null;
  deliveryNotes?: string | null;
  assignedCsName?: string | null;
  campaignCustomFieldDefs?: OrderClipboardSummaryCustomFieldDef[];
  customFields?: Record<string, unknown> | null;
};

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatCustomFieldValue(value: string | number | boolean | string[] | undefined | null): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  return truncate(s, CUSTOM_VALUE_MAX);
}

export function buildOrderClipboardSummaryText(order: OrderClipboardSummaryInput): string {
  const lines: string[] = [];

  const orderRef = order.orderNumber != null ? formatOrderNumber(order.orderNumber) : order.id;
  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  lines.push(`Order No:      ${orderRef}${orderDate ? ` (${orderDate})` : ''}`);
  lines.push('');

  lines.push(`Customer Name: ${order.customerName}`);
  lines.push('');

  lines.push(`Mobile:        ${order.customerPhoneForPaste}`);
  lines.push('');

  const addr = order.deliveryAddress?.trim() || order.customerAddress?.trim();
  lines.push(`Address:       ${addr || 'Not provided'}`);
  lines.push('');

  if (order.deliveryState?.trim()) {
    lines.push(`State:         ${order.deliveryState.trim()}`);
    lines.push('');
  }

  // Items: (Product name | qty)
  if (order.orderItems?.length) {
    lines.push('Items:');
    for (const item of order.orderItems) {
      const name = item.productName ?? item.productId;
      lines.push(`(${name} | ${item.quantity} |)`);
    }
    lines.push('');
  }

  const t = Number(order.totalAmount);
  lines.push(`TOTAL AMOUNT:  ${Number.isFinite(t) && t > 0 ? formatNaira(t) : 'N/A'}`);
  lines.push('');

  lines.push(`Closer:        ${order.assignedCsName || 'Unassigned'}`);
  lines.push('');

  lines.push(`Payment:       ${order.paymentStatus || 'N/A'}`);

  if (order.preferredDeliveryDate) {
    lines.push(`Delivery Date: ${order.preferredDeliveryDate}`);
  }

  const logisticsParts = [order.logisticsProviderName, order.logisticsLocationName].filter(Boolean);
  if (logisticsParts.length > 0) {
    lines.push(`Logistics:     ${logisticsParts.join(' — ')}`);
  }

  if (order.deliveryNotes?.trim()) {
    lines.push('');
    lines.push(`Notes: ${truncate(order.deliveryNotes.trim(), NOTES_MAX)}`);
  }

  // Campaign custom fields
  const defs = order.campaignCustomFieldDefs;
  const cf = order.customFields;
  if (defs?.length && cf && typeof cf === 'object') {
    const sorted = [...defs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const extra: string[] = [];
    for (const d of sorted) {
      if (!(d.id in cf)) continue;
      const raw = cf[d.id];
      const formatted = formatCustomFieldValue(raw as string | number | boolean | string[]);
      if (!formatted) continue;
      extra.push(`${d.label}: ${formatted}`);
    }
    if (extra.length) {
      lines.push('');
      extra.forEach((l) => lines.push(l));
    }
  }

  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
