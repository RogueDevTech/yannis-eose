/** Inbound shipment still contributing FIFO units at this shelf row (batch remaining > 0). */
export interface InventoryLevelShipmentLayer {
  id: string;
  referenceLabel: string;
}

export interface InventoryLevel {
  id: string;
  productId: string;
  locationId: string;
  stockCount: number;
  reservedCount: number;
  status: string;
  updatedAt: string;
  /** Shipments whose verified lines created batches that still have remaining qty for this product at this destination. */
  shipmentLayers?: InventoryLevelShipmentLayer[];
  /** True when non-shipment INTAKE (e.g. legacy manual intake) still has FIFO remaining at this location. */
  hasManualFifoRemaining?: boolean;
}

export interface StockMovement {
  id: string;
  productId: string;
  movementType: string;
  quantity: number;
  fromLocationId: string | null;
  fromLocationName?: string | null;
  toLocationId: string | null;
  toLocationName?: string | null;
  referenceId?: string | null;
  referenceCustomerName?: string | null;
  orderShortId?: string | null;
  orderNumber?: number | null;
  reason: string | null;
  actorId: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  createdAt: string;
}

export const MOVEMENT_COLORS: Record<string, string> = {
  INTAKE: 'badge-success',
  RESERVATION: 'badge-info',
  ALLOCATION: 'badge-brand',
  DISPATCH: 'badge-brand',
  DELIVERY: 'badge-success',
  RETURN: 'badge-warning',
  RESTOCK: 'badge-success',
  WRITE_OFF: 'badge-danger',
  TRANSFER_OUT: 'badge-warning',
  TRANSFER_IN: 'badge-info',
  ADJUSTMENT: 'badge-warning',
};

export function formatMovementType(type: string): string {
  return type.replace(/_/g, ' ');
}

/**
 * Movement `reason` strings are persisted verbatim; older rows still say "3PL".
 * Normalize for UI (modal, audit table) without rewriting history in the DB.
 */
export function formatMovementReasonForDisplay(reason: string | null | undefined): string {
  if (reason == null || reason.trim() === '') return '';
  return reason
    .replace(/\bAllocated to 3PL\b/gi, 'Allocated to logistics company')
    .replace(/\breleased 3PL reservation\b/gi, 'released logistics company reservation')
    .replace(/\bRestocked at 3PL\b/gi, 'Restocked at logistics company')
    .replace(/\bThis 3PL location\b/gi, 'This logistics company location')
    .replace(/\b3PL\b/g, 'logistics company');
}

/** Product option for shipment receive UI */
export interface ProductOption {
  id: string;
  name: string;
}

/** Location option for shipment receive UI */
export interface LocationOption {
  id: string;
  name: string;
  providerName: string | null;
  providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null;
}

export interface ShipmentFilterOption {
  id: string;
  label: string;
}

export interface WarehouseRowLite {
  id: string;
  name: string;
  address: string;
  dispatchLocked: boolean;
  stockSummary: { totalStock: number; totalReserved: number; skuCount: number };
}

/** Streaming loader shape — movements arrive as a deferred promise */
export interface InventoryStreamData {
  levels: InventoryLevel[];
  /** Sum of stock/reserved/delivered across all rows matching current filters (not just this page). */
  levelsTotals?: { totalStock: number; totalReserved: number; totalDelivered: number; totalLocations: number };
  totalLevels: number;
  /** Server-side pagination state for the Stock Levels tab. */
  levelsPage?: number;
  levelsTotalPages?: number;
  levelsLimit?: number;
  /** Product UUID filter (empty string = no filter). */
  levelsProductFilter?: string;
  /** Logistics location UUID filter (empty string = no filter). */
  levelsLocationFilter?: string;
  /** Logistics provider UUID filter (empty string = no filter). */
  levelsProviderFilter?: string;
  /** Inbound shipment UUID filter (empty string = no filter). */
  levelsShipmentFilter?: string;
  /** Broader location list for resolving names on stock rows (3PL, etc.); warehouse-only list stays on `locations` for receive UI. */
  displayLocations?: LocationOption[];
  /** Substring search against product name (empty string = no search). */
  levelsSearch?: string;
  /** `default` | `lowestAvailable` | `highestAvailable`. */
  levelsSort?: 'default' | 'lowestAvailable' | 'highestAvailable';
  /** Resolved sort key (the new explicit URL contract used by SortMenu). */
  levelsSortBy?: 'available' | 'updatedAt';
  /** Resolved sort direction. */
  levelsSortDir?: 'asc' | 'desc';
  movements: StockMovement[];
  totalMovements: number;
  products: ProductOption[];
  locations: LocationOption[];
  /** When false, Receive Shipment actions are hidden (`inventory.intake` gate). */
  canIntake?: boolean;
  /** When false, shipment detail links are rendered as plain labels in inventory context. */
  canReadShipments?: boolean;
  /** When false, the row-level "Edit" (stock adjust) action is hidden. */
  canAdjust?: boolean;
  /** When false, the Generate report button is hidden. SuperAdmin/Admin + STOCK_MANAGER only. */
  canExport?: boolean;
  /** TPL combined view: transfers, returns, reconciliations */
  transfers?: Transfer[];
  returnedOrders?: ReturnedOrder[];
  reconciliations?: Promise<Reconciliation[]> | Reconciliation[];
  /** Locations with dispatchLocked info (for returns) */
  locationsWithLock?: LocationWithLock[];
  /** Org-wide low-stock alert threshold (units). Drives auto-notifications. */
  lowStockThreshold?: number;
  /** When true, the threshold control is editable (SuperAdmin / Admin). Otherwise read-only. */
  canEditLowStock?: boolean;
  /** Low-stock items currently below threshold — drives the inline banner. Streamed. */
  lowStockAlerts?: Promise<LowStockAlertsResult> | LowStockAlertsResult;
  /**
   * Every active location with its per-location low-stock override (or NULL to
   * inherit the org-wide threshold). Includes zero-inventory locations so admins
   * can pre-set alerts before stock arrives.
   */
  locationThresholds?: LocationLowStockThreshold[];
  /** Lightweight shipment labels for the stock-level `shipmentId` filter. */
  shipmentOptions?: ShipmentFilterOption[];
  /** Inhouse warehouses summary list (so warehouse stock is visible on /admin/inventory). */
  warehouses?: WarehouseRowLite[];
  /**
   * When set, streams threshold + low-stock banner + shipment filter options + warehouses after levels/movements paint.
   * Resolved fields are merged into the page (see `InventoryPage`).
   */
  inventoryExtras?: Promise<{
    lowStockThreshold: number;
    lowStockAlerts: LowStockAlertsResult;
    shipmentOptions: ShipmentFilterOption[];
    warehouses: WarehouseRowLite[];
  }>;
  /** Set when `inventory.levels` failed — avoids silent empty state after timeout/API errors. */
  levelsLoadError?: string | null;
  /** Set when `inventory.movements` failed — movement tabs / stats may be incomplete. */
  movementsLoadError?: string | null;
}

export interface LowStockAlertItem {
  levelId: string;
  /** null for locations that have never received any stock. */
  productId: string | null;
  productName: string;
  locationId: string;
  locationName: string;
  stockCount: number;
  reservedCount: number;
  availableCount: number;
}

export interface LowStockAlertsResult {
  threshold: number;
  items: LowStockAlertItem[];
}

/**
 * Per-location low-stock alert configuration. `lowStockThreshold` is the
 * location-specific override (NULL = inherit org-wide). `effectiveThreshold`
 * is what the alert engine actually uses for this location right now.
 */
export interface LocationLowStockThreshold {
  id: string;
  name: string;
  providerName: string | null;
  providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
}

/* ── Transfer & Returns types (for combined TPL inventory view) ── */

export interface Transfer {
  id: string;
  productId: string;
  quantitySent: number;
  quantityReceived: number | null;
  fromLocationId: string;
  toLocationId: string;
  transferStatus: string;
  shrinkageReason: string | null;
  transferCost: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface ReturnedOrder {
  id: string;
  customerName: string;
  status: string;
  items: unknown;
  logisticsLocationId: string | null;
  deliveryNotes: string | null;
  updatedAt: string;
}

export interface Reconciliation {
  id: string;
  locationId: string;
  productId: string;
  digitalCount: number;
  physicalCount: number;
  discrepancy: number;
  reasonCode: string;
  notes: string | null;
  reconciliationStatus: string;
  submittedBy: string;
  approvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface LocationWithLock {
  id: string;
  name: string;
  address: string;
  dispatchLocked: boolean;
  status: string;
}

export const TRANSFER_STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge',
  IN_TRANSIT: 'badge-warning',
  RECEIVED: 'badge-success',
  DISPUTED: 'badge-danger',
};

export const RECON_STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
};

export const REASON_LABELS: Record<string, string> = {
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  EXPIRED: 'Expired',
  THEFT: 'Suspected Theft',
  COUNTING_ERROR: 'Counting Error',
  OTHER: 'Other',
};

/* ── Inbound shipments — multi-line supplier receipts ── */

export type ShipmentStatus =
  | 'CREATED'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'VERIFIED'
  | 'CLOSED'
  | 'CANCELLED';

export interface ShipmentRow {
  id: string;
  referenceNumber: number;
  referenceLabel: string;
  label: string | null;
  status: ShipmentStatus;
  destinationLocationId: string;
  destinationLocationName: string | null;
  supplierName: string | null;
  supplierReference: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  verifiedAt: string | null;
  closedAt: string | null;
  totalLandingCost: string | null;
  createdAt: string;
  lineCount: number;
  totalExpected: number;
  totalReceived: number;
}

export interface ShipmentDetail {
  shipment: {
    id: string;
    referenceNumber: number;
    referenceLabel: string;
    label: string | null;
    status: ShipmentStatus;
    destinationLocationId: string;
    destinationLocationName: string | null;
    supplierName: string | null;
    supplierReference: string | null;
    expectedArrivalAt: string | null;
    arrivedAt: string | null;
    verifiedAt: string | null;
    closedAt: string | null;
    cancelledAt: string | null;
    totalLandingCost: string;
    cancelledReason: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  lines: Array<{
    id: string;
    productId: string;
    productName: string | null;
    expectedQuantity: number;
    receivedQuantity: number | null;
    factoryCost: string;
    allocatedLandingCost: string | null;
    batchId: string | null;
    batchRemainingQuantity: number | null;
    consumedQuantity: number | null;
    currentReservedCount: number | null;
    varianceReason: string | null;
    createdAt: string;
  }>;
  summary: {
    totalReceived: number;
    remainingFromShipment: number;
    consumedFromShipment: number;
    currentReserved: number;
    verifiedLineCount: number;
  };
  stockDistribution: Array<{
    locationId: string;
    locationName: string;
    isDestination: boolean;
    stock: number;
    reserved: number;
    available: number;
    sold: number;
  }>;
  allowedTransitions: string[];
}

export const SHIPMENT_STATUS_VARIANT: Record<
  ShipmentStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  CREATED: 'neutral',
  IN_TRANSIT: 'warning',
  ARRIVED: 'info',
  VERIFIED: 'success',
  CLOSED: 'success',
  CANCELLED: 'danger',
};

export function formatShipmentStatus(status: ShipmentStatus): string {
  switch (status) {
    case 'CREATED':
      return 'Created';
    case 'IN_TRANSIT':
      return 'In transit';
    case 'ARRIVED':
      return 'Arrived';
    case 'VERIFIED':
      return 'Verified';
    case 'CLOSED':
      return 'Closed';
    case 'CANCELLED':
      return 'Cancelled';
  }
}
