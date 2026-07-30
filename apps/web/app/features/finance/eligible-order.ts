import type { OrderInvoice } from '~/features/orders/types';

/** A DELIVERED order eligible for (or included in) a cash remittance batch. */
export interface EligibleOrder {
  id: string;
  orderNumber: number | null;
  customerName: string;
  totalAmount: string | null;
  /** Delivery fee already set on the order (e.g. by CS closer). */
  deliveryFee: string | null;
  deliveredAt: string | null;
  logisticsLocationId: string | null;
  logisticsLocationName: string | null;
  logisticsLocationProviderName: string | null;
  /** Auto-generated invoice when present (CONFIRM side effect); null for legacy rows. */
  invoice: OrderInvoice | null;
  isDuplicate?: string | null;
  duplicateOfId?: string | null;
}
