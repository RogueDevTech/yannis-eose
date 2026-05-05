export interface InventoryLevel {
  id: string;
  productId: string;
  locationId: string;
  stockCount: number;
  reservedCount: number;
  status: string;
  updatedAt: string;
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

/** Product option for Stock Intake */
export interface ProductOption {
  id: string;
  name: string;
}

/** Location option for Stock Intake */
export interface LocationOption {
  id: string;
  name: string;
  providerName: string | null;
}

/** Streaming loader shape — movements arrive as a deferred promise */
export interface InventoryStreamData {
  levels: InventoryLevel[];
  totalLevels: number;
  /** Server-side pagination state for the Stock Levels tab. */
  levelsPage?: number;
  levelsTotalPages?: number;
  levelsLimit?: number;
  /** Product UUID filter (empty string = no filter). */
  levelsProductFilter?: string;
  /** Logistics location UUID filter (empty string = no filter). */
  levelsLocationFilter?: string;
  /** Substring search against product name (empty string = no search). */
  levelsSearch?: string;
  /** `default` | `lowestAvailable` | `highestAvailable`. */
  levelsSort?: 'default' | 'lowestAvailable' | 'highestAvailable';
  movements: StockMovement[];
  totalMovements: number;
  products: ProductOption[];
  locations: LocationOption[];
  /** When false, Stock Intake button and form are hidden (view-only). */
  canIntake?: boolean;
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
}

export interface LowStockAlertItem {
  levelId: string;
  productId: string;
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
