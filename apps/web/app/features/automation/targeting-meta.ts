import type { AutomationChannel } from './types';

/**
 * EVENT trigger sources the engine understands (mirrors AUTOMATION_EVENTS on the
 * server). A raw "order created" trigger is intentionally NOT offered — the
 * engine only hooks non-frozen lifecycle points, never the edge-form intake.
 */
export const AUTOMATION_EVENT_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'order:confirmed', label: 'Order confirmed', hint: 'Fires when an order is confirmed by CS.' },
  { value: 'order:delivered', label: 'Order delivered', hint: 'Fires when an order is marked delivered.' },
  { value: 'order:status_changed', label: 'Order status changed', hint: 'Fires on a status change. Pick the target status below.' },
  { value: 'cart:abandoned', label: 'Cart abandoned', hint: 'Fires when a cart is abandoned without an order.' },
];

/**
 * Order statuses offered in the SEGMENT audience builder + the status_changed
 * "to status". Curated to the marketing-meaningful states (not the full internal
 * enum) so the picker stays legible.
 */
export const AUTOMATION_SEGMENT_STATUSES: { value: string; label: string }[] = [
  { value: 'UNPROCESSED', label: 'Unprocessed' },
  { value: 'CS_ASSIGNED', label: 'CS assigned' },
  { value: 'CS_ENGAGED', label: 'CS engaged' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'REMITTED', label: 'Remitted' },
  { value: 'RETURNED', label: 'Returned' },
];

/** A branch option for the segment builder + the branch-scope filter. */
export interface AutomationBranchOption {
  id: string;
  name: string;
}

/**
 * Placeholders the automation engine substitutes at send time (see
 * render-template.ts). The template modal offers these via an "Insert variable"
 * picker. Syntax is {{name}} — matched exactly by the engine.
 */
export const AUTOMATION_TEMPLATE_VARIABLES: { token: string; label: string }[] = [
  { token: 'customer_name', label: 'Customer name' },
  { token: 'customer_phone', label: 'Customer phone' },
  { token: 'order_id', label: 'Order ID' },
  { token: 'product_name', label: 'Product name' },
  { token: 'delivery_address', label: 'Delivery address' },
  { token: 'estimated_date', label: 'Estimated date' },
  { token: 'quantity', label: 'Quantity' },
  { token: 'total_amount', label: 'Total amount' },
  { token: 'payment_status', label: 'Payment status' },
];

/** Template row surfaced to the picker. */
export interface AutomationTemplateOption {
  id: string;
  name: string;
  channels: AutomationChannel[];
  subject: string | null;
}
