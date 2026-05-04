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
  /**
   * When this transfer was created from an approved funding request, this points back at
   * the request id. The unified feeds use it to drop the request row (now redundant) and
   * keep the transfer as the canonical record post-approval.
   */
  sourceFundingRequestId?: string | null;
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
  /** Ad spend / total orders (period), when merged from leaderboard */
  cpa?: number;
  trueRoas?: number;
  /** min(1, trueRoas / target); null when no ad spend in period */
  profitabilityScore?: number | null;
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

export type DistributingFundingEntryType = 'transfer' | 'request';

export interface DistributingFundingTransferEntry {
  id: string;
  entryType: 'transfer';
  status: 'SENT' | 'COMPLETED' | 'DISPUTED';
  amount: string;
  createdAt: string;
  senderId: string;
  senderName: string | null;
  receiverId: string;
  receiverName: string | null;
  receiptUrl: string | null;
  /**
   * When this transfer was created from an approved funding request. Used in the unified
   * feed to drop the now-redundant request row and surface a small "from request" chip
   * on the transfer instead.
   */
  sourceFundingRequestId?: string | null;
  /** Optional — original requester's name (for the "from request" chip). */
  sourceRequesterName?: string | null;
}

export interface DistributingFundingRequestEntry {
  id: string;
  entryType: 'request';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  amount: string;
  createdAt: string;
  requesterId: string;
  requesterName: string | null;
  reason: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  receiptUrl: string | null;
}

export type DistributingFundingEntry =
  | DistributingFundingTransferEntry
  | DistributingFundingRequestEntry;

export type AdPlatform = 'FACEBOOK' | 'TIKTOK' | 'GOOGLE' | 'OTHER';

export interface AdSpendRecord {
  id: string;
  mediaBuyerId: string;
  productId: string;
  campaignId: string;
  spendAmount: string;
  screenshotUrl: string;
  adUrl?: string | null;
  platform?: AdPlatform;
  platformCustomLabel?: string | null;
  spendDate: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionReason?: string | null;
  rejectedAt?: string | null;
  rejectedBy?: string | null;
  /** Populated by `listAdSpend` — same window as Log Ad Spend preview. */
  orderCount?: number;
  indicativeCpa?: number | null;
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
  REJECTED: number;
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
  /** Pulled through from marketing.listCampaigns so the Add Expense modal can
   * auto-fill the product when a campaign is picked. May be empty/null on older rows. */
  productIds?: string[] | null;
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
  distributingEntries?: {
    records: DistributingFundingEntry[];
    total: number;
    page: number;
    totalPages: number;
    typeFilter: 'all' | DistributingFundingEntryType;
    statusFilter?: string;
    searchFilter?: string;
    typeCounts: {
      all: number;
      transfer: number;
      request: number;
    };
    statusCounts: {
      SENT: number;
      COMPLETED: number;
      DISPUTED: number;
      PENDING: number;
      APPROVED: number;
      REJECTED: number;
      ALL: number;
    };
  };

  /** Top strip + supporting data */
  directionSummary: FundingDirectionSummary;
  /** Media Buyer / HoM: running balance (COMPLETED transfers in minus APPROVED ad spend). */
  fundingBalance?: { totalReceived: string; totalSpend: string; balance: string };
  users: User[];
  balancesList?: FundingBalanceRow[];
  /**
   * Name of the caller's active branch (resolved from `currentBranchId`).
   * `null` when the caller is in global-view mode (admin viewing all branches) — the
   * Send Funding modal then omits the "Showing Media Buyers in <branch>" hint because
   * no branch scoping is being applied.
   */
  activeBranchName?: string | null;
  /**
   * Recipient candidates for the Request Funding modal (migration 0106). MBs see
   * HoMs in their branch + Finance Officers org-wide; HoMs see Finance Officers.
   * Sorted with preferred recipient (HoM for MB, first Finance for HoM) first.
   */
  fundingRequestRecipients?: Array<{
    id: string;
    name: string;
    role: string;
    isFinance: boolean;
    isPreferred: boolean;
    branchId: string | null;
  }>;
}

export type AdSpendStatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RolledStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'MIXED';

/** Single line within an ad-spend day group (Phase 17 accordion). */
export interface AdSpendGroupLine {
  id: string;
  mediaBuyerId: string;
  mediaBuyerName: string | null;
  productId: string;
  productName: string | null;
  campaignId: string;
  campaignName: string | null;
  spendAmount: string;
  screenshotUrl: string;
  adUrl: string | null;
  platform: AdPlatform;
  platformCustomLabel?: string | null;
  spendDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

/** One accordion row = one (date × MB) batch with its line items. */
export interface AdSpendGroup {
  spendDate: string;
  mediaBuyerId: string;
  mediaBuyerName: string | null;
  lineCount: number;
  totalAmount: string;
  rolledStatus: RolledStatus;
  lines: AdSpendGroupLine[];
}

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
  /** Narrow to one campaign (HoM / admin). */
  campaignIdFilter?: string;
  /** Narrow to one media buyer (HoM / admin). */
  mediaBuyerIdFilter?: string;
  /** Active MEDIA_BUYER users for the media-buyer filter dropdown (admin view only). */
  mediaBuyersForFilter: Array<{ id: string; name: string }>;
  statusCounts: AdSpendStatusCounts;
  campaigns: Campaign[];
  metrics: Metrics;
  leaderboard: LeaderboardEntry[];
  users: User[];
  products: Product[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters: MarketingDateFilters;
  viewMode: 'admin' | 'media_buyer';
  /**
   * Phase 21: true when the actor can approve / reject ad-spend submissions
   * (legacy roles `SUPER_ADMIN` / `ADMIN` / `HEAD_OF_MARKETING`, OR a custom role
   * with `marketing.adSpend.approve`). Distinct from `viewMode` because admin
   * roles without moderation power (e.g. data-only Finance) shouldn't see the
   * Approve/Reject buttons even though they're not in media-buyer view.
   */
  canApproveAdSpend: boolean;
  /** Grouped accordion view (Phase 17). Groups are page-sliced — pagination is on groups. */
  groups: AdSpendGroup[];
  groupsTotal: number;
  groupsPage: number;
  groupsTotalPages: number;
  /** Current user's id — used to gate per-line "Edit" actions on the accordion
   *  (MB can edit their own PENDING/REJECTED rows; moderators can edit any). */
  currentUserId: string;
}
