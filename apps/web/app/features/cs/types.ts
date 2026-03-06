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

/** Single item in the live activities feed (from socket events). */
export interface CSActivityItem {
  id: string;
  type: 'order:new' | 'order:status_changed' | 'order:assigned' | 'order:reassigned' | 'order:assigned_bulk' | 'order:assignments_changed' | 'cs:duplicates_changed' | 'cart:updated';
  orderId?: string;
  description: string;
  timestamp: string;
  meta?: Record<string, unknown>;
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
  // Deferred (streaming promises)
  inactiveAgents: Promise<InactiveAgent[]>;
  callbackOrders: Promise<CSOrder[]>;
  flaggedDuplicates: Promise<DuplicatePair[]>;
  leaderboard: Promise<CSLeaderboardEntry[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
  cartStats?: Promise<{ pending: number; abandonedLast24h: number }>;
  pendingCarts?: Promise<PendingCart[]>;
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /** When true, show "Create offline order" button (CS_AGENT / HEAD_OF_CS). */
  canCreateOffline?: boolean;
  /** Products list for offline order form (when canCreateOffline). */
  productsForOfflineOrder?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
}
