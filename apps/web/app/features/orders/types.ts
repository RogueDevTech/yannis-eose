export interface Order {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  assignedCsId: string | null;
  /** Set in list when available (e.g. CS orders for HoS/SuperAdmin) */
  assignedCsName?: string | null;
  /** Set in list when available (e.g. marketing orders for HoM/SuperAdmin) */
  mediaBuyerId?: string | null;
  mediaBuyerName?: string | null;
}

export interface CallLogEntry {
  id: string;
  orderId: string;
  agentId: string;
  callToken: string | null;
  callStatus: string;
  durationSeconds: number | null;
  recordingUrl: string | null;
  startedAt: string;
}

export interface OrderDetail {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  customerAddress: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  confirmedAt: string | null;
  allocatedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  assignedCsId: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paymentReference?: string | null;
  customerEmail?: string | null;
  orderItems: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    /** Resolved from products.name when loading order detail */
    productName?: string | null;
  }>;
  callLogs: Array<{
    id: string;
    callStatus: string;
    durationSeconds: number | null;
    startedAt: string;
  }>;
  allowedTransitions: string[];
  /** Optional fields returned by API from orders table; shown dynamically in Details */
  campaignId?: string | null;
  mediaBuyerId?: string | null;
  logisticsProviderId?: string | null;
  logisticsLocationId?: string | null;
  riderId?: string | null;
  deliveryState?: string | null;
  customerGender?: string | null;
  preferredDeliveryDate?: string | null;
  deliveryOtp?: string | null;
  deliveryGpsLat?: string | null;
  deliveryGpsLng?: string | null;
  parentOrderId?: string | null;
  paymentProvider?: string | null;
  callbackScheduledAt?: string | null;
  callbackAttempts?: number | null;
  callbackNotes?: string | null;
  isDuplicate?: string | null;
  duplicateOfId?: string | null;
  lockedUntil?: string | null;
  lockedBy?: string | null;
  landedCost?: string | null;
  deliveryFee?: string | null;
  updatedAt?: string | null;
  /** Resolved display names when API enriches getById */
  assignedCsName?: string | null;
  mediaBuyerName?: string | null;
  campaignName?: string | null;
  logisticsProviderName?: string | null;
  logisticsLocationName?: string | null;
  riderName?: string | null;
  lockedByName?: string | null;
  /** Delivery remittance status (SENT, RECEIVED, DISPUTED) — null if not yet remitted */
  remittanceStatus?: string | null;
  /** Delivery remittance batch ID — null if not yet remitted */
  remittanceId?: string | null;
}

export interface HistoryEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  changedBy: string | null;
  validFrom: string;
  validTo: string | null;
  data: Record<string, unknown>;
}

export interface OrderDetailPageProps {
  order: OrderDetail;
  latestCall: CallLogEntry | null;
  history: HistoryEntry[];
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface OrderDetailStreamData {
  // Critical (resolved immediately) — 404 check requires await
  order: OrderDetail;
  // Deferred (streaming promises)
  latestCall: Promise<CallLogEntry | null>;
  history: Promise<HistoryEntry[]>;
  // Strict Data Mode flag
  strictDataMode: boolean;
  // VOIP feature flag
  voipEnabled: boolean;
}

/** Passed from route when user has view-only access (e.g. Media Buyer) */
export interface OrderDetailPageExtraProps {
  canEditOrder?: boolean;
  userRole: string;
  userId: string;
  permissions: string[];
  csAgentsForAssign?: Array<{ id: string; name: string }>;
}
