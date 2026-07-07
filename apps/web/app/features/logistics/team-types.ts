/**
 * Logistics Team Analysis row — one per provider company.
 * Mirrors the shape returned by `logistics.teamOverview` (see
 * `apps/api/src/logistics/logistics.service.ts::getLogisticsProviderPerformance`).
 */
export interface LogisticsProviderRow {
  providerId: string;
  providerName: string;
  status: string;
  locationCount: number;
  totalAssigned: number;
  delivered: number;
  partiallyDelivered: number;
  returned: number;
  writtenOff: number;
  cancelled: number;
  inTransit: number;
  dispatched: number;
  allocated: number;
  /** 0–100 — delivered / totalAssigned * 100 (DELIVERED + COMPLETED count as delivered). */
  deliveryRate: number;
  /** 0–100 — (returned + partiallyDelivered + writtenOff) / totalAssigned * 100. */
  delinquencyRate: number;
  /** Per-status percentage breakdown for the stacked-bar mix column. Sums to ~100. */
  statusBreakdown: { status: string; count: number; pct: number }[];
  /** Sum of order totals on this provider's RECEIVED batches in the period (₦). */
  remittedAmount: string;
  /** Sum of order totals on this provider's still-SENT (Pending) batches in the period (₦). */
  pendingRemittanceAmount: string;
  /** Sum of order totals on this provider's DISPUTED batches in the period (₦). */
  disputedRemittanceAmount: string;
  /** Net amount of DELIVERED orders not yet on any remittance batch (₦). */
  owingAmount: string;
  /** Count of DELIVERED orders not yet on any remittance batch. */
  owingCount: number;
  /** Total units (bottles) delivered — SUM(order_items.quantity) for DELIVERED/REMITTED orders. */
  unitsDelivered: number;
  /** Available stock across all locations for this provider. */
  availableStock: number;
  /** Reserved stock across all locations for this provider. */
  reservedStock: number;
  /** Stock reconciliation: total units ever received (INTAKE+TRANSFER_IN+RESTOCK). */
  stockReceived: number;
  /** Stock reconciliation: total units sold (DELIVERY movements). */
  stockSold: number;
  /** Stock reconciliation: total units transferred out. */
  stockTransferredOut: number;
  /** Stock reconciliation: total negative manual adjustments. */
  stockAdjusted: number;
  /** Stock reconciliation: total units written off. */
  stockWrittenOff: number;
  /** Stock reconciliation: total units dispatched to agents. */
  stockDispatched: number;
}

/** Per-location row from `logistics.locationOverview`. */
export interface LogisticsLocationRow {
  locationId: string;
  locationName: string;
  providerId: string;
  providerName: string;
  status: string;
  totalAssigned: number;
  delivered: number;
  returned: number;
  partiallyDelivered: number;
  writtenOff: number;
  deliveryRate: number;
  delinquencyRate: number;
  unitsDelivered: number;
  availableStock: number;
  reservedStock: number;
  remittedAmount: string;
  pendingRemittanceAmount: string;
  stockReceived: number;
  stockSold: number;
  stockTransferredOut: number;
  stockAdjusted: number;
  stockWrittenOff: number;
  stockDispatched: number;
}

/** Single logistics company from `logistics.getProvider` (loader detail page). */
export type LogisticsProviderDetailRecord = {
  id: string;
  name: string;
  contactInfo: string | null;
  coverageArea: string | null;
  rateCard: unknown;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  locationCount: number;
};
