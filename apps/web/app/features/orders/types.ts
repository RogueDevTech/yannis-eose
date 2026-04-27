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
  /** Order branch — used for Branch Admin RBAC on CS actions */
  branchId?: string | null;
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
  /**
   * Form-builder responses keyed by `customField.id`. Persisted to `orders.custom_fields`
   * JSONB. Render via `campaignCustomFieldDefs` (which provides label + type for each id).
   */
  customFields?: Record<string, string | number | boolean | string[]> | null;
  /**
   * Field definitions for the campaign that produced this order — pulled from the
   * campaign's `formConfig.customFields` so the UI can render `label: value` rows.
   * Empty array when the campaign has no custom fields or the order has no campaign.
   */
  campaignCustomFieldDefs?: Array<{
    id: string;
    type: string;
    label: string;
    order: number;
    options?: string[];
  }>;
  /** From getById — true when this viewer may change line unit prices / derived total */
  viewerCanEditOrderLinePrices?: boolean;
  /** From getById — branch CS team supervisor for the assigned agent (same branch session) */
  viewerIsCsTeamSupervisor?: boolean;
  /** PENDING permission_request id for ORDER_LINE_PRICE_CHANGE, if any */
  pendingOrderLinePriceRequestId?: string | null;
  /** PENDING permission_request id for ORDER_DELETION (archive), if any */
  pendingOrderDeletionRequestId?: string | null;
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

export interface TimelineEvent {
  id: string;
  orderId: string;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface OrderDetailPageProps {
  order: OrderDetail;
  latestCall: CallLogEntry | null;
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface OrderDetailStreamData {
  // Critical (resolved immediately) — 404 check requires await
  order: OrderDetail;
  // Deferred (streaming promises)
  latestCall: Promise<CallLogEntry | null>;
  timeline: Promise<TimelineEvent[]>;
  // VOIP feature flag + active provider context. The active provider (Africa's Talking)
  // bridges the agent's physical phone to the customer, so the UI shows
  // "Your phone is ringing" feedback rather than an in-browser softphone overlay.
  voipEnabled: boolean;
  /** Display name of the active provider — kept as a string so the UI doesn't hard-code the brand. */
  voipProviderDisplayName?: string;
}

/** Passed from route when user has view-only access (e.g. Media Buyer) */
export interface OrderDetailPageExtraProps {
  canEditOrder?: boolean;
  userRole: string;
  userId: string;
  /** Active branch from session — paired with `order.branchId` for Branch Admin gates */
  currentBranchId?: string | null;
  permissions: string[];
  csAgentsForAssign?: Array<{ id: string; name: string }>;
  logisticsLocations?: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null }>;
  allocatableLocations?: Array<{
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink?: string | null;
    eligible: boolean;
    reason: string | null;
  }>;
  /** WhatsApp group dispatch templates — loaded for the CS "Share to logistics company" flow. */
  logisticsDispatchTemplates?: Array<{ id: string; name: string; body: string }>;
  /** Auto-generated invoice for the order (CONFIRMED side effect). null if none yet. Streamed. */
  invoice?: Promise<OrderInvoice | null> | OrderInvoice | null;
}

export interface OrderInvoice {
  id: string;
  orderId: string | null;
  referenceNumber: number;
  referenceFormatted: string;
  recipientInfo: { name: string; address?: string; email?: string; phone?: string };
  lineItems: { description: string; quantity: number; unitPrice: string }[];
  totalAmount: string;
  taxRate: string | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
}
