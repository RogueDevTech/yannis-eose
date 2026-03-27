export interface AgentWorkload {
  agentId: string;
  agentName: string;
  capacity: number;
  pendingCount: number;
  lastActionAt: string | null;
}

export interface InactiveAgent {
  agentId: string;
  agentName: string;
  lastActionAt: string | null;
  pendingCount: number;
}

export interface CSOrder {
  id: string;
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

/** Team member with optional workload, leaderboard, and idle state for CS Team overview page. */
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
  productName: string | null;
  campaignName: string | null;
  offerLabel: string | null;
  updatedAt: string;
}

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
  /** Order total amount — null for carts that haven't converted yet */
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

/** Tab keys for Live Activities (/admin/cs/queue). */
export const CS_QUEUE_TAB_VALUES = [
  'queue',
  'active',
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

/** What the loader returns — mix of resolved data + streaming promises */
export interface CSDashboardStreamData {
  // Critical (resolved immediately)
  workloads: AgentWorkload[];
  unassignedOrders: CSOrder[];
  unassignedTotal: number;
  activeOrders: CSOrder[];
  activeTotal: number;
  statusCounts: Record<string, number>;
  /** True when CS_DISPATCH_STRATEGY = 'claim' (no auto-assignment). */
  isClaimMode?: boolean;
  /** Max orders a CS agent can hold in claim mode before Claim button is disabled. */
  claimCap?: number;
  /** Initial cart activity payload rendered on first paint before fetcher refreshes. */
  initialCartActivity?: {
    activityItems: LiveActivityItem[];
    pendingCarts: PendingCart[];
    abandonedCarts: PendingCart[];
  };
  // Deferred (streaming promises)
  inactiveAgents: Promise<InactiveAgent[]>;
  callbackOrders: Promise<CSOrder[]>;
  flaggedDuplicates: Promise<DuplicatePair[]>;
  leaderboard: Promise<CSLeaderboardEntry[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
  cartStats?: Promise<{ pending: number; abandonedLast24h: number }>;
  /** Deferred claim queue — only populated when isClaimMode is true. */
  claimQueue?: Promise<CSOrder[]>;
  pendingCarts?: Promise<PendingCart[]>;
  abandonedCarts?: Promise<PendingCart[]>;
  activityItems?: Promise<LiveActivityItem[]>;
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /** When true, show "Create offline order" button (CS_AGENT / HEAD_OF_CS). */
  canCreateOffline?: boolean;
  /** When true, show Delete button on abandoned carts (HEAD_OF_CS / SuperAdmin). */
  canDeleteCart?: boolean;
  /** Products list for offline order form (when canCreateOffline). */
  productsForOfflineOrder?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
  /** Deep-link: open this tab on load (from `?tab=`). */
  initialTab?: CSQueueTab;
  /** Deep-link: pre-select this agent ID as "From" in Hot Swap (requires initialTab === 'hotswap'). */
  initialHotSwapFrom?: string;
}
