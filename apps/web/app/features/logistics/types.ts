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
  status: string;
  dispatchLocked?: boolean;
  createdAt: string;
  providerName: string | null;
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

/** Order summary for delivery confirmation request list */
export interface DeliveryConfirmationOrderSummary {
  id: string;
  status: string;
  customerName: string;
  deliveryAddress: string | null;
  riderId: string | null;
  logisticsLocationId: string | null;
}

/** Delivery confirmation request (rider/3PL submit → HOL approve/reject) */
export interface DeliveryConfirmationRequest {
  id: string;
  orderId: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  payload: { newStatus: string; otp?: string; gpsLat?: number; gpsLng?: number; [k: string]: unknown };
  order?: DeliveryConfirmationOrderSummary | null;
  requesterName?: string | null;
}

/** Orders already in ALLOCATED and eligible for direct delivery confirmation. */
export interface AllocatedDeliveryOrder {
  id: string;
  status: string;
  customerName: string;
  deliveryAddress: string | null;
}

/** Streaming-aware loader shape for the logistics route */
export interface LogisticsStreamData {
  providers: Provider[];
  totalProviders: number;
  locations: Location[];
  totalLocations: number;
}
