export interface AgentWorkload {
  agentId: string;
  agentName: string;
  capacity: number;
  pendingCount: number;
  /** CS stage closes today (confirm + cancel), Africa/Lagos calendar — display-only. */
  todayClosesCount: number;
  lastActionAt: string | null;
}

/** Line item on a closer's pending workload order (from `orders.closerWorkloadOrders`). */
export interface CloserWorkloadOrderItem {
  productName: string | null;
  quantity: number;
  unitPrice: string;
  offerLabel: string | null;
}

export interface CloserWorkloadOrder {
  id: string;
  status: string;
  customerName: string;
  createdAt: string;
  updatedAt: string;
  totalAmount: string | null;
  items: CloserWorkloadOrderItem[];
}

export interface InactiveAgent {
  agentId: string;
  agentName: string;
  lastActionAt: string | null;
  pendingCount: number;
}

export interface CSOrder {
  id: string;
  /** Set on API list rows — needed for branch-scoped mutations when session has no `currentBranchId`. */
  branchId?: string | null;
  customerName: string;
  customerPhoneDisplay: string;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  assignedCsId: string | null;
  callbackScheduledAt?: string | null;
  callbackAttempts?: number;
  callbackNotes?: string | null;
  isDuplicate?: string | null;
  duplicateOfId?: string | null;
  items?: unknown;
}

export interface DuplicatePair {
  duplicate: CSOrder;
  original: CSOrder | null;
  /** 'FLAGGED' = same phone in last 24h (urgent triage).
   *  'POSSIBLY_DUPLICATE' = same phone older than 24h within 30d (softer signal). */
  flagKind?: 'FLAGGED' | 'POSSIBLY_DUPLICATE';
}

export interface CSLeaderboardEntry {
  agentId: string;
  agentName: string;
  ordersEngaged: number;
  ordersConfirmed: number;
  ordersCancelled: number;
  ordersDelivered: number;
  callsMade: number;
  confirmationRate: number;
  deliveryRate: number;
  avgCallDurationSeconds: number;
}

export interface CSUserBranchMembership {
  branchId: string;
  branchName: string;
  branchCode: string;
  isPrimary: boolean;
  roleInBranch: string | null;
}

/** Team member with optional workload, leaderboard, and idle state for Sales Team overview page. */
export interface CSTeamMemberOverview {
  id: string;
  name: string;
  role: string;
  branchMemberships?: CSUserBranchMembership[];
  workload?: AgentWorkload;
  leaderboardEntry?: CSLeaderboardEntry;
  isIdle: boolean;
}

export interface CSDashboardLoaderData {
  workloads: AgentWorkload[];
  unassignedOrders: CSOrder[];
  unassignedTotal: number;
  activeOrders: CSOrder[];
  activeTotal: number;
  statusCounts: Record<string, number>;
  inactiveAgents: InactiveAgent[];
  callbackOrders: CSOrder[];
  flaggedDuplicates: DuplicatePair[];
  leaderboard: CSLeaderboardEntry[];
}

export interface PendingCart {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  /**
   * Raw customer phone — populated only for ABANDONED carts when the caller has
   * `cart.delete` permission (or SUPER_ADMIN). Used by the abandoned-cart detail
   * modal to render dialable contact details without a per-card reveal round-trip.
   * Always null for PENDING carts and for callers without reveal authority.
   * CEO directive 2026-05-08, Pillar 2 still applies — UI must not render this in
   * lists, only in the detail modal opened by an authorized actor.
   */
  customerPhone?: string | null;
  productId?: string | null;
  productName: string | null;
  campaignName: string | null;
  offerLabel: string | null;
  updatedAt: string;
  // Progressive form-field capture (migration 0142). All optional — a dropped
  // cart may carry any subset of these depending on how far the customer got.
  customerEmail?: string | null;
  customerAddress?: string | null;
  deliveryAddress?: string | null;
  deliveryState?: string | null;
  deliveryNotes?: string | null;
  customerGender?: string | null;
  preferredDeliveryDate?: string | null;
  paymentMethod?: string | null;
  quantity?: number | null;
  customFieldValues?: Record<string, unknown> | null;
  /** Whether this cart was recovered into a cart order. */
  recovered?: boolean;
  /** Why the auto-pull cron skipped this cart (e.g. 'DUPLICATE_ORDER'). */
  skipReason?: string | null;
  /** The order that blocked recovery. */
  duplicateOfOrderId?: string | null;
  /** The cart order that blocked recovery. */
  duplicateOfCartOrderId?: string | null;
  /** The follow-up order that blocked recovery. */
  duplicateOfFollowUpOrderId?: string | null;
}

/** Pagination meta for `cart.listAbandoned` (CS abandoned tab + cart resource loader). */
export interface AbandonedCartPagination {
  total: number;
  page: number;
  limit: number;
}

/** Page size for CS abandoned tab / `cart.listAbandoned` Remix loaders. */
export const ABANDONED_CARTS_PAGE_SIZE = 25;

/** A single item in the Live Activity feed — a cart that may have progressed to an order. */
export interface LiveActivityItem {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  productName: string | null;
  offerLabel: string | null;
  /** Status of the cart_abandonments row — null for direct orders with no cart */
  cartStatus: 'PENDING' | 'ABANDONED' | 'CONVERTED' | null;
  /** Current order status when cart was converted — null if still a cart */
  orderStatus: string | null;
  /** Order ID when converted */
  linkedOrderId: string | null;
  /** Order total, else offer price, else product base sale price (see cart.listActivity) */
  totalAmount: string | null;
  updatedAt: string;
}

/** Single item in the live activities feed (from socket events). */
export interface CSActivityItem {
  id: string;
  type: 'order:new' | 'order:status_changed' | 'order:assigned' | 'order:reassigned' | 'order:assigned_bulk' | 'order:assignments_changed' | 'cs:duplicates_changed' | 'cart:updated';
  orderId?: string;
  description: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

/** Tab keys for Live Activities (/admin/sales/queue). */
export const CS_QUEUE_TAB_VALUES = [
  'queue',
  'abandoned',
  'callbacks',
  'hotswap',
  'performance',
  'claim',
] as const;
export type CSQueueTab = (typeof CS_QUEUE_TAB_VALUES)[number];

/** Parse `?tab=` for deep links; `claim` only valid when claim dispatch mode is on. */
export function parseCSQueueTabFromSearchParam(
  tabParam: string | null,
  isClaimMode: boolean,
): CSQueueTab | undefined {
  if (!tabParam) return undefined;
  if (!CS_QUEUE_TAB_VALUES.includes(tabParam as CSQueueTab)) return undefined;
  if (tabParam === 'claim' && !isClaimMode) return undefined;
  return tabParam as CSQueueTab;
}

/** Primary queue bundle resolved after shell — streamed via `defer` so the page shell can paint first. */
export interface CSDashboardCriticalPayload {
  workloads: AgentWorkload[];
  unassignedOrders: CSOrder[];
  unassignedTotal: number;
  activeOrders: CSOrder[];
  activeTotal: number;
  /**
   * Hot Swap order list for `?hotSwapFrom=` / `?from=` when opening Hot Swap — matches workload
   * pipeline (UNPROCESSED, CS_ASSIGNED, CS_ENGAGED) for that closer, up to 100 rows.
   */
  hotSwapOrdersPayload: { forAgentId: string; orders: CSOrder[]; total: number } | null;
  statusCounts: Record<string, number>;
  /** Initial cart activity payload rendered on first paint before fetcher refreshes. */
  initialCartActivity: {
    activityItems: LiveActivityItem[];
    pendingCarts: PendingCart[];
    abandonedCarts: PendingCart[];
    abandonedPagination?: AbandonedCartPagination;
  };
  /** Non-empty when any primary-bundle request failed (timeout/API) — avoid silent empty queues. */
  criticalFetchErrors: string[];
}

/** Dispatch settings slice — streamed with the layout so claim tabs wire without blocking workloads. */
export interface CSDashboardShell {
  isClaimMode: boolean;
  claimCap: number;
}

/** `/admin/sales/queue` loader — shell + primary bundle stream in parallel + existing deferred slices. */
export interface CSDashboardPageProps {
  shell: Promise<CSDashboardShell>;
  criticalData: Promise<CSDashboardCriticalPayload>;
  inactiveAgents: Promise<InactiveAgent[]>;
  callbackOrders: Promise<CSOrder[]>;
  flaggedDuplicates: Promise<DuplicatePair[]>;
  leaderboard: Promise<CSLeaderboardEntry[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
  cartStats?: Promise<{ pending: number; abandonedOpen: number }>;
  /** Deferred claim queue — only populated when shell.isClaimMode is true. */
  claimQueue?: Promise<CSOrder[]>;
  liveEvents?: string[];
  canCreateOffline?: boolean;
  /** Gates phone-reveal + recover on the abandoned-cart detail modal. */
  canManageAbandonedCart?: boolean;
  /**
   * Order cancellation is Head of CS / Branch Admin / Admin only — closers (and
   * teamless supervisors) can no longer cancel orders (CEO directive 2026-05-20).
   * Gates the "Cancel Order" actions on the queue + active-order modals.
   */
  canCancelOrders?: boolean;
  /** Products for offline order modal — loaded in parallel with primary bundle. */
  productsForOfflineOrder: Promise<
    Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>
  >;
}

