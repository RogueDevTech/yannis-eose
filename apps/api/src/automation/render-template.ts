/**
 * Placeholder rendering for automation messages. Mirrors the CS-messaging
 * substitution set (`messaging.router.ts`) so a template authored for agent
 * sends renders identically when an automation rule uses it. Kept as a pure
 * function (no DB) so the engine and any preview path share one implementation.
 */
export interface AutomationOrderContext {
  id: string;
  orderNumber?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  totalAmount?: string | number | null;
  paymentStatus?: string | null;
  preferredDeliveryDate?: string | null;
  productName?: string | null;
  quantity?: number | null;
}

/** Substitute {{placeholder}} tokens from an order context. Unknown tokens are left as-is. */
export function renderAutomationBody(body: string, order: AutomationOrderContext): string {
  const orderDisplay =
    order.orderNumber != null
      ? `YNS-${String(order.orderNumber).padStart(5, '0')}`
      : order.id.slice(0, 8).toUpperCase();
  const totalAmount = order.totalAmount != null ? String(order.totalAmount) : '';
  const quantity = order.quantity != null ? String(order.quantity) : '';

  return body
    .replace(/\{\{\s*customer_name\s*\}\}/g, order.customerName ?? '')
    .replace(/\{\{\s*customer_phone\s*\}\}/g, order.customerPhone ?? '')
    .replace(/\{\{\s*order_id\s*\}\}/g, orderDisplay)
    .replace(/\{\{\s*product_name\s*\}\}/g, order.productName ?? '')
    .replace(/\{\{\s*delivery_address\s*\}\}/g, order.deliveryAddress ?? '')
    .replace(/\{\{\s*estimated_date\s*\}\}/g, order.preferredDeliveryDate ?? '')
    .replace(/\{\{\s*quantity\s*\}\}/g, quantity)
    .replace(/\{\{\s*total_amount\s*\}\}/g, totalAmount)
    .replace(/\{\{\s*payment_status\s*\}\}/g, order.paymentStatus ?? '');
}
