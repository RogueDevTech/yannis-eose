/**
 * Plain-text order summary for WhatsApp / logistics handoff.
 * Used by the API (full phone when stored) and the web (digit-mask / Hidden fallback).
 */

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
  status: string;
  customerName: string;
  /** Full number or a short explanation when the number is not on file. */
  customerPhoneForPaste: string;
  deliveryAddress?: string | null;
  customerAddress?: string | null;
  orderItems?: OrderClipboardSummaryOrderItem[];
  totalAmount?: string | null;
  preferredDeliveryDate?: string | null;
  logisticsLocationName?: string | null;
  paymentStatus?: string | null;
  deliveryNotes?: string | null;
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
  const lines: string[] = ['Yannis — Order summary', ''];

  lines.push(`Order ID: ${order.id}`);
  lines.push(`Status: ${order.status}`);
  lines.push(`Customer: ${order.customerName}`);
  lines.push(`Phone: ${order.customerPhoneForPaste}`);
  lines.push('');

  const addr = order.deliveryAddress?.trim() || order.customerAddress?.trim();
  if (addr) {
    lines.push('Address:');
    lines.push(addr);
    lines.push('');
  }

  if (order.orderItems?.length) {
    lines.push('Items:');
    for (const item of order.orderItems) {
      const name = item.productName ?? item.productId;
      const unit = Number(item.unitPrice);
      const sub = item.quantity * unit;
      const subStr = Number.isFinite(unit)
        ? `${item.quantity} × ${formatNaira(unit)} = ${formatNaira(sub)}`
        : `Qty: ${item.quantity}`;
      lines.push(`- ${name}: ${subStr}`);
    }
    lines.push('');
  }

  if (order.totalAmount != null && order.totalAmount !== '') {
    const t = Number(order.totalAmount);
    if (Number.isFinite(t)) {
      lines.push(`Total: ${formatNaira(t)}`);
      lines.push('');
    }
  }

  if (order.preferredDeliveryDate) {
    lines.push(`Preferred delivery: ${order.preferredDeliveryDate}`);
    lines.push('');
  }

  if (order.logisticsLocationName) {
    lines.push(`Logistics company location: ${order.logisticsLocationName}`);
    lines.push('');
  }

  if (order.paymentStatus) {
    lines.push(`Payment: ${order.paymentStatus}`);
    lines.push('');
  }

  if (order.deliveryNotes?.trim()) {
    lines.push(`Notes: ${truncate(order.deliveryNotes.trim(), NOTES_MAX)}`);
    lines.push('');
  }

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
      lines.push('Additional:');
      extra.forEach((l) => lines.push(l));
      lines.push('');
    }
  }

  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
