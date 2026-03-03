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
  status: string;
  createdAt: string;
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
  healthDashboard: Promise<HealthDashboard | null> | null;
  canViewEscalations: boolean;
}
