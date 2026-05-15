export interface Provider {
  id: string;
  name: string;
  contactInfo: string | null;
  coverageArea: string | null;
  status: string;
  createdAt: string;
}

export interface Location {
  id: string;
  providerId: string;
  name: string;
  address: string;
  coordinates: string | null;
  whatsappGroupLink?: string | null;
  /** Per-location low-stock alert threshold (units). NULL = inherit org-wide. */
  lowStockThreshold?: number | null;
  status: string;
  dispatchLocked?: boolean;
  createdAt: string;
  providerName: string | null;
  /** Total available stock (stock - reserved) across all products at this location. */
  totalStock?: number;
}

export interface ShrinkageAlert {
  transferId: string;
  productName: string;
  fromLocationName: string;
  toLocationName: string;
  quantitySent: number;
  quantityReceived: number | null;
  shortage: number;
  shrinkageReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface StuckOrder {
  orderId: string;
  status: string;
  customerName: string;
  deliveryAddress: string | null;
  riderId: string | null;
  riderName: string | null;
  dispatchedAt: string | null;
  updatedAt: string;
  stuckHours: number;
}

export interface TransferDelay {
  transferId: string;
  productName: string;
  fromLocationName: string;
  toLocationName: string;
  quantitySent: number;
  createdAt: string;
  delayHours: number;
}

export interface HealthDashboard {
  shrinkageAlerts: ShrinkageAlert[];
  shrinkageCount: number;
  stuckOrders: StuckOrder[];
  stuckOrdersCount: number;
  transferDelays: TransferDelay[];
  transferDelaysCount: number;
  totalEscalations: number;
}

/** Streaming-aware loader shape for the logistics route */
export interface LogisticsStreamData {
  providers: Provider[];
  totalProviders: number;
  locations: Location[];
  totalLocations: number;
  /** Org-wide low-stock alert threshold (units) — fallback when a location has no override. */
  globalLowStockThreshold: number;
}
