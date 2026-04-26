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

/** `marketing.previewAdSpendInterval` — form helper, not the same window as dashboard CPA. */
export interface AdSpendIntervalPreview {
  orderCount: number;
  priorSpendDate: string | null;
  windowStartExclusive: string | null;
  indicativeCpa: number | null;
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

export type FundingRequestStatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Funding page section — mirrors the two-tier model so the URL matches the user's
 * mental map: "Funds I've Received" or "Funds I Distribute".
 */
export type FundingSection = 'received' | 'distributing';

/** Within a section, which list is showing — Transfers (money) or Requests (asks). */
export type FundingTab = 'transfers' | 'requests';

/** A paginated transfers slice (one section/tab combination's worth of rows + counts). */
export interface FundingSliceData {
  records: FundingRecord[];
  total: number;
  page: number;
  totalPages: number;
  statusCounts: FundingStatusCounts;
  statusFilter?: string;
  searchFilter?: string;
}

/** A paginated requests slice. */
export interface FundingRequestsSliceData {
  records: FundingRequestRecord[];
  total: number;
  page: number;
  totalPages: number;
  statusCounts: FundingRequestStatusCounts;
  statusFilter?: FundingRequestStatusFilter;
  searchFilter?: string;
}

/** Per-actor directional summary used by the page top strip. */
export interface FundingDirectionSummary {
  totalReceived: string;
  totalDistributed: string;
  pendingMarkReceived: number;
  disputedAsReceiver: number;
  disputedAsSender: number;
}

/** `/admin/marketing/funding` loader + component props (post 2026-04-26 split) */
export interface MarketingFundingLoaderData {
  /** Role flags + identity */
  viewMode: 'admin' | 'media_buyer';
  currentUserId: string;
  currentUserRole: string;
  canSendFunding: boolean;
  canRequestFunding: boolean;
  /** HoM/Admin: primary tab "Funds I Distribute" + outgoing slices. False for MB. */
  canDistribute: boolean;

  /** URL state */
  activeSection: FundingSection;
  activeTab: FundingTab;
  filters: MarketingDateFilters;

  /** Section 1 — "Funds I've Received" (always shown) */
  receivedTransfers: FundingSliceData;
  myRequests: FundingRequestsSliceData;

  /** Section 2 — "Funds I Distribute" (HoM / Admin only) */
  outgoingTransfers?: FundingSliceData;
  mbRequests?: FundingRequestsSliceData;

  /** Top strip + supporting data */
  directionSummary: FundingDirectionSummary;
  /** Media Buyer / HoM: running balance (COMPLETED transfers in minus APPROVED ad spend). */
  fundingBalance?: { totalReceived: string; totalSpend: string; balance: string };
  /** Used by the HighCpaWarningBanner (HoM/Admin only). */
  leaderboard: LeaderboardEntry[];
  leaderboardPeriod: 'this_month' | 'all_time';
  users: User[];
  balancesList?: FundingBalanceRow[];
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
  /** Currently selected product filter — narrows the list to one product so HoM can audit
   * spend product-by-product. `undefined` = all products. */
  productIdFilter?: string;
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
