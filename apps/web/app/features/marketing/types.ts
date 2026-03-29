export interface FundingRecord {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  receiptUrl: string | null;
  status: string;
  sentAt: string;
  verifiedAt: string | null;
  senderName?: string | null;
  receiverName?: string | null;
}

export interface FundingBalanceRow {
  userId: string;
  name: string;
  role: string;
  totalReceived: string;
  totalSpend: string;
  balance: string;
  /** This month's confirmation rate (0–100), when loaded from team page with leaderboard */
  confirmationRate?: number;
  /** This month's delivery rate (0–100), when loaded from team page with leaderboard */
  deliveryRate?: number;
}

export interface FundingRequestRecord {
  id: string;
  requesterId: string;
  amount: string;
  reason: string | null;
  status: string;
  receiptUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Requester display name when returned by API (e.g. listFundingRequests join) */
  requesterName?: string | null;
}

export interface AdSpendRecord {
  id: string;
  mediaBuyerId: string;
  productId: string;
  campaignId: string;
  spendAmount: string;
  screenshotUrl: string;
  spendDate: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** Counts for ad spend log status filter (scoped by date + branch + search + optional product/campaign). */
export interface AdSpendStatusCounts {
  PENDING: number;
  APPROVED: number;
  ALL: number;
}

export interface Metrics {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number;
  cpa: number;
  trueRoas: number;
  deliveryRate: number;
}

export interface LeaderboardEntry {
  mediaBuyerId: string;
  name: string;
  email: string;
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number;
  cpa: number;
  trueRoas: number;
  deliveryRate: number;
}

/** Minimal order row for Marketing Overview "Live orders" list. */
export interface MarketingOverviewRecentOrder {
  id: string;
  status: string;
  createdAt: string;
  totalAmount: string | null;
  customerName: string;
  mediaBuyerName?: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
}

/** Optional date filter — when provided, DateFilterBar is shown and data is filtered by it */
export interface MarketingDateFilters {
  startDate: string;
  endDate: string;
  periodAllTime: boolean;
}

/** Counts for funding ledger filters (scoped by date + branch + optional receiver). */
export interface FundingStatusCounts {
  SENT: number;
  COMPLETED: number;
  DISPUTED: number;
  ALL: number;
}

/** Counts for funding request filters (scoped by date + branch + requester for media buyers). */
export interface FundingRequestStatusCounts {
  PENDING: number;
  APPROVED: number;
  REJECTED: number;
  ALL: number;
}

export type FundingActivityFeed = 'ledger' | 'requests';

export type FundingRequestStatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED';

/** `/admin/marketing/funding` loader + component props */
export interface MarketingFundingLoaderData {
  funding: FundingRecord[];
  totalFunding: number;
  page: number;
  limit: number;
  totalPages: number;
  statusFilter?: string;
  searchFilter?: string;
  statusCounts: FundingStatusCounts;
  fundingRequests: FundingRequestRecord[];
  /** URL feed: transfers vs funding requests (same table shell). */
  feed: FundingActivityFeed;
  showFundingRequestsFeed: boolean;
  requestStatusFilter?: FundingRequestStatusFilter;
  requestSearchFilter?: string;
  requestStatusCounts: FundingRequestStatusCounts;
  totalFundingRequests: number;
  totalPagesRequests: number;
  metrics: Metrics;
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  leaderboard: LeaderboardEntry[];
  users: User[];
  leaderboardPeriod: 'this_month' | 'all_time';
  balancesList?: FundingBalanceRow[];
  filters: MarketingDateFilters;
  viewMode: 'admin' | 'media_buyer';
  canSendFunding: boolean;
  canRequestFunding: boolean;
  currentUserId: string;
}

export type AdSpendStatusFilter = 'PENDING' | 'APPROVED';

/** `/admin/marketing/ad-spend` loader + component props */
export interface MarketingAdSpendLoaderData {
  adSpend: AdSpendRecord[];
  totalAdSpend: number;
  adSpendTotal: string;
  page: number;
  limit: number;
  totalPages: number;
  statusFilter?: AdSpendStatusFilter;
  searchFilter?: string;
  statusCounts: AdSpendStatusCounts;
  campaigns: Campaign[];
  metrics: Metrics;
  leaderboard: LeaderboardEntry[];
  users: User[];
  products: Product[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters: MarketingDateFilters;
  viewMode: 'admin' | 'media_buyer';
}
