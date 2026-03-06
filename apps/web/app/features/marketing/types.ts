export interface FundingRecord {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  receiptUrl: string | null;
  status: string;
  sentAt: string;
  verifiedAt: string | null;
}

export interface FundingBalance {
  totalReceived: string;
  totalSpend: string;
  balance: string;
}

export interface FundingBalanceRow {
  userId: string;
  name: string;
  role: string;
  totalReceived: string;
  totalSpend: string;
  balance: string;
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

export interface Metrics {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
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

export interface MarketingPageProps {
  funding: FundingRecord[];
  totalFunding: number;
  adSpend: AdSpendRecord[];
  totalAdSpend: number;
  adSpendTotal: string;
  metrics: Metrics;
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  users: User[];
  products: Product[];
  campaigns: Campaign[];
  leaderboard: LeaderboardEntry[];
}

/** Optional date filter — when provided, DateFilterBar is shown and data is filtered by it */
export interface MarketingDateFilters {
  startDate: string;
  endDate: string;
  periodAllTime: boolean;
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface MarketingStreamData {
  // Critical (resolved immediately)
  funding: FundingRecord[];
  totalFunding: number;
  fundingRequests: FundingRequestRecord[];
  adSpend: AdSpendRecord[];
  totalAdSpend: number;
  adSpendTotal: string;
  campaigns: Campaign[];
  metrics: Metrics;
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  leaderboard: LeaderboardEntry[];
  users: User[];
  products: Product[];
  leaderboardPeriod: 'this_month' | 'all_time';
  myBalance?: FundingBalance;
  balancesList?: FundingBalanceRow[];
  /** Optional; when set, date filter bar is shown and loader has applied date filtering */
  filters?: MarketingDateFilters;
  /** 'media_buyer' = own data + request funds; 'admin' = full overview + send funding */
  viewMode?: 'admin' | 'media_buyer';
  /** True for Head of Marketing, SuperAdmin, Finance Officer — can use Send Funding */
  canSendFunding?: boolean;
  /** Current user id — used to show Received/Not Received only for the funding recipient */
  currentUserId?: string;
}
