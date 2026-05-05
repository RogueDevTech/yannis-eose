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
