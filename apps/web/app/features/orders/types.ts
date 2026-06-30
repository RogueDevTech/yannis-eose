export interface Order {
  id: string;
  orderNumber?: number | null;
  customerName: string;
  customerPhoneDisplay: string;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  /** ISO `YYYY-MM-DD` when set (CS confirm); list API includes full row. */
  preferredDeliveryDate?: string | null;
  /** ISO datetime — when a CS callback was scheduled. Drives the "Callback due" row tag. */
  callbackScheduledAt?: string | null;
  assignedCsId: string | null;
  /** Set in list when available (e.g. Sales orders for HoS/SuperAdmin) */
  assignedCsName?: string | null;
  /** Set in list when available (e.g. marketing orders for HoM/SuperAdmin) */
  mediaBuyerId?: string | null;
  mediaBuyerName?: string | null;
  /**
   * "Primary" line item — first order_items row by id. Drives the Product column on
   * the orders table. Multi-line orders also expose `itemCount` so the cell can
   * render "Product A · +2 more".
   */
  primaryProductId?: string | null;
  primaryProductName?: string | null;
  itemCount?: number;
  /** Form / campaign the order came in from. Used by the Media Buyer view. */
  campaignId?: string | null;
  campaignName?: string | null;
  /**
   * Back-link to the abandoned cart this order was recovered from. Non-null only
   * for cart-recovered orders — drives the "View cart" quick-detail row action.
   */
  cartId?: string | null;
  /** Duplicate flag: FLAGGED | POSSIBLY_DUPLICATE | MERGED | DISMISSED | null */
  isDuplicate?: string | null;
  /** When true, order is frozen — no status transitions, assignments, or edits allowed. */
  frozenForFollowUp?: boolean;
  /** Last CS comment left on the order — shown as an icon + tooltip on the list. */
  lastCsComment?: { comment: string; actorName: string | null; at: string } | null;
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
  orderNumber?: number | null;
  customerName: string;
  customerPhoneDisplay: string;
  customerAddress: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  status: string;
  totalAmount: string | null;
  /** When true, order is frozen — pulled into follow-up pipeline. No mutations allowed. */
  frozenForFollowUp?: boolean;
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
    /** Selected offer tier label, when this line was set from a campaign offer */
    offerLabel?: string | null;
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
  /** ISO `YYYY-MM-DD` — set at confirm; shown as Schedule date on the detail page */
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
  /** From getById — branch Sales team supervisor for the assigned agent (same branch session) */
  viewerIsCsTeamSupervisor?: boolean;
  /** PENDING permission_request id for ORDER_LINE_PRICE_CHANGE, if any */
  pendingOrderLinePriceRequestId?: string | null;
  /** Proposed item changes from a pending ORDER_LINE_PRICE_CHANGE request */
  pendingLinePriceChangeProposal?: {
    items: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
    totalAmount: number;
    reason: string;
    requesterName: string | null;
  } | null;
  /** PENDING permission_request id for ORDER_DELETION (archive), if any */
  pendingOrderDeletionRequestId?: string | null;
  /** PENDING permission_request id for DELIVERED_ORDER_DELETION, if any */
  pendingDeliveredOrderDeletionRequestId?: string | null;
}

/**
 * A campaign-scoped offer tier available for one product on an order. Selecting
 * a tier in the Adjust order items modal sets quantity + unit price together so
 * a bundled discount applies instead of hand-editing the amount.
 */
export interface OrderItemOffers {
  productId: string;
  offers: Array<{ label: string; quantity: number; unitPrice: number }>;
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

/** `admin.orders.$id` deferred payload: loaded order, missing order, or API error (not a fake 404). */
export type OrderDetailLoaderResult =
  | OrderDetailStreamData
  | { notFound: true }
  | { loadError: string };

/** What the loader returns — mix of resolved data + streaming promises */
export interface OrderDetailStreamData {
  // Critical (resolved immediately) — 404 check requires await
  order: OrderDetail;
  // Deferred (streaming promises)
  latestCall: Promise<CallLogEntry | null>;
  /** Optional — when omitted, the page loads activity client-side after mount. */
  timeline?: Promise<TimelineEvent[]>;
  // VOIP feature flag + active provider context. The active provider (Africa's Talking)
  // bridges the agent's physical phone to the customer, so the UI shows
  // "Your phone is ringing" feedback rather than an in-browser softphone overlay.
  voipEnabled: boolean;
  /** Display name of the active provider — kept as a string so the UI doesn't hard-code the brand. */
  voipProviderDisplayName?: string;
  /** Campaign-scoped offer tiers per product — powers the Adjust order items offer picker. */
  itemOffers: OrderItemOffers[];
  /** All active products with offers — powers product-swap in the Adjust order items modal. */
  productsForAdjust?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string | number; qty: number }> }>;
  /** Pre-loaded callable phone when VOIP is off and viewer is authorised — no separate reveal fetch. */
  callablePhone?: { phone: string; isDialable: boolean } | null;
  /** True when this is a follow-up order (lives in follow_up_orders, not orders). */
  isFollowUpOrder?: boolean;
  /** True when this is a cart order (lives in cart_orders, not orders). */
  isCartOrder?: boolean;
}

/** Passed from route when user has view-only access (e.g. Media Buyer) */
export interface OrderDetailPageExtraProps {
  canEditOrder?: boolean;
  userRole: string;
  userId: string;
  /** Active branch from session — paired with `order.branchId` for Branch Admin gates */
  currentBranchId?: string | null;
  permissions: string[];
  csClosersForAssign?: Array<{ id: string; name: string }>;
  logisticsLocations?: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null; providerName?: string | null }>;
  allocatableLocations?: Array<{
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink?: string | null;
    providerName: string | null;
    /** From logistics provider row — `WAREHOUSE` is internal inventory, not a 3PL hand-off. */
    providerKind?: string | null;
    eligible: boolean;
    reason: string | null;
    /**
     * Per-product remaining stock at this location for the order's line items.
     * Server returns `null` when the viewer is not allowed to see counts (e.g. CS_CLOSER).
     * When non-null, the UI renders these counts inline in the allocate dropdown.
     */
    availabilityByProduct: Array<{
      productId: string;
      productName: string;
      needed: number;
      available: number;
    }> | null;
    /**
     * Coarse stock-band hint for viewers who can't see exact counts (CS_CLOSER).
     * Server returns `null` when the viewer has exact counts via `availabilityByProduct`.
     */
    stockBandByProduct?: Array<{
      productId: string;
      productName: string;
      band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
    }> | null;
  }>;
  /**
   * Heavy: eligibility + per-product availability per location.
   * Prefer streaming this (deferred) so order detail loads fast, and only the allocate modal waits.
   */
  allocatableLocationsDeferred?: Promise<
    Array<{
      id: string;
      name: string;
      address: string | null;
      whatsappGroupLink?: string | null;
      providerName: string | null;
      providerKind?: string | null;
      eligible: boolean;
      reason: string | null;
      availabilityByProduct: Array<{
        productId: string;
        productName: string;
        needed: number;
        available: number;
      }> | null;
      stockBandByProduct?: Array<{
        productId: string;
        productName: string;
        band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
      }> | null;
    }>
  >;
  /** WhatsApp group dispatch templates — loaded for the Sales "Share to logistics company" flow. */
  logisticsDispatchTemplates?: Array<{ id: string; name: string; body: string }>;
  /** Auto-generated invoice for the order (CONFIRMED side effect). null if none yet. Streamed. */
  invoice?: Promise<OrderInvoice | null> | OrderInvoice | null;
  /** Campaign-scoped offer tiers per product — powers the Adjust order items offer picker. */
  itemOffers?: OrderItemOffers[];
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
  /**
   * True when the order's cash has been confirmed received via a delivery
   * remittance (`delivery_remittances.status = 'RECEIVED'`). Drives the
   * "MARKED AS PAID" rubber-stamp on the invoice preview + PDF — see
   * `InvoiceDocumentPreview` and `buildInvoicePdf`. Server-derived; the
   * frontend never flips this on its own.
   */
  markedPaid?: boolean;
}
