import { json } from '@remix-run/node';
import { apiRequest, defaultThisMonthRange, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import type {
  AdSpendRecord,
  AdSpendStatusCounts,
  Campaign,
  DistributingFundingEntry,
  FundingBalanceRow,
  FundingRecord,
  FundingRequestRecord,
  FundingStatusCounts,
  FundingRequestStatusCounts,
  LeaderboardEntry,
  Metrics,
  Product,
  User,
} from '~/features/marketing/types';

export function parseFunding(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (
    (res.data as {
      result?: {
        data?: {
          records: FundingRecord[];
          pagination: { page: number; limit: number; total: number };
        };
      };
    })?.result?.data ?? null
  );
}

export function parseFundingStatusCounts(res: { ok: boolean; data: unknown }): FundingStatusCounts {
  if (!res.ok) return { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
  const data = (res.data as { result?: { data?: FundingStatusCounts } })?.result?.data;
  return data ?? { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
}

const emptyFundingRequestStatusCounts = (): FundingRequestStatusCounts => ({
  PENDING: 0,
  APPROVED: 0,
  REJECTED: 0,
  ALL: 0,
});

export function parseFundingRequestStatusCounts(res: { ok: boolean; data: unknown }): FundingRequestStatusCounts {
  if (!res.ok) return emptyFundingRequestStatusCounts();
  const data = (res.data as { result?: { data?: FundingRequestStatusCounts } })?.result?.data;
  return data ?? emptyFundingRequestStatusCounts();
}

export function parseAdSpend(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: AdSpendRecord[]; totalSpend: string; pagination: { total: number } } } })?.result?.data ?? null;
}

const emptyAdSpendStatusCounts = (): AdSpendStatusCounts => ({
  PENDING: 0,
  APPROVED: 0,
  REJECTED: 0,
  ALL: 0,
});

export function parseAdSpendStatusCounts(res: { ok: boolean; data: unknown }): AdSpendStatusCounts {
  if (!res.ok) return emptyAdSpendStatusCounts();
  const data = (res.data as { result?: { data?: AdSpendStatusCounts } })?.result?.data;
  return data ?? emptyAdSpendStatusCounts();
}

const emptyMetrics = (): Metrics => ({
  totalSpend: 0,
  pendingSpend: 0,
  approvedSpend: 0,
  totalOrders: 0,
  deliveredOrders: 0,
  deliveredRevenue: 0,
  confirmedOrders: 0,
  confirmationRate: 0,
  cpa: 0,
  trueRoas: 0,
  deliveryRate: 0,
});

export function parseMetrics(res: { ok: boolean; data: unknown }): Metrics {
  const data = res.ok ? (res.data as { result?: { data?: Metrics } })?.result?.data : null;
  return data ?? emptyMetrics();
}

export function parseFundingSummary(res: { ok: boolean; data: unknown }) {
  const data = res.ok
    ? (res.data as { result?: { data?: { totalSent: string; totalCompleted: string; totalDisputed: string } } })?.result?.data
    : null;
  return data ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
}

const emptyDirectionSummary = () => ({
  totalReceived: '0',
  totalDistributed: '0',
  pendingMarkReceived: 0,
  disputedAsReceiver: 0,
  disputedAsSender: 0,
});

/** Parse the actor-keyed directional summary used by the Funding page top strip. */
export function parseFundingDirectionSummary(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return emptyDirectionSummary();
  const data = (res.data as {
    result?: {
      data?: {
        totalReceived: string;
        totalDistributed: string;
        pendingMarkReceived: number;
        disputedAsReceiver: number;
        disputedAsSender: number;
      };
    };
  })?.result?.data;
  return data ?? emptyDirectionSummary();
}

/** Received − distributed − APPROVED ad spend (same as `marketing.getFundingBalance`). */
export function parseFundingBalance(res: { ok: boolean; data: unknown }):
  | { totalReceived: string; totalDistributed: string; totalSpend: string; balance: string }
  | undefined {
  if (!res.ok) return undefined;
  const data = (res.data as {
    result?: {
      data?: {
        totalReceived: string;
        totalDistributed: string;
        totalSpend: string;
        balance: string;
      };
    };
  })?.result?.data;
  return data ?? undefined;
}

export function parseUsers(res: { ok: boolean; data: unknown }): User[] {
  const data = res.ok ? (res.data as { result?: { data?: { users: User[] } } })?.result?.data : null;
  return data?.users ?? [];
}

export function parseProducts(res: { ok: boolean; data: unknown }): Product[] {
  const data = res.ok ? (res.data as { result?: { data?: { products: Product[] } } })?.result?.data : null;
  return data?.products ?? [];
}

export function parseCampaigns(res: { ok: boolean; data: unknown }): Campaign[] {
  const data = res.ok ? (res.data as { result?: { data?: { campaigns: Campaign[] } } })?.result?.data : null;
  return data?.campaigns ?? [];
}

/** Campaigns + products for `/admin/marketing/ad-spend/new` (shared with ad-spend list filtering). */
export async function loadAdSpendExpenseFormData(
  cookie: string,
  opts: { mediaBuyerId?: string },
): Promise<{ campaigns: Campaign[]; products: Product[] }> {
  const campaignsInput = JSON.stringify(
    opts.mediaBuyerId ? { mediaBuyerId: opts.mediaBuyerId, page: 1, limit: 50 } : { page: 1, limit: 50 },
  );
  // Explicit input keeps us aligned with the form-page loader (page=1, limit=100,
  // ACTIVE only, sorted by name) and gives `products.list` enough headroom to
  // return all the catalog items the dropdown needs. Default `limit` is 20, which
  // truncates the list and confuses MBs with several products.
  const productsInput = JSON.stringify({
    page: 1,
    limit: 100,
    status: 'ACTIVE',
    sortBy: 'name',
    sortOrder: 'asc',
  });
  // `products.list` is the slow side of this fetch on a remote DB (per-viewer
  // scope queries + list + count + inventory aggregate). Bump the timeout to
  // 15s so the form doesn't render with empty dropdowns when the default 4.5s
  // ceiling is exceeded — same pattern the forms list page now uses.
  const [campaignsRes, productsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${encodeURIComponent(campaignsInput)}`, {
      method: 'GET',
      cookie,
    }),
    apiRequest<unknown>(`/trpc/products.list?input=${encodeURIComponent(productsInput)}`, {
      method: 'GET',
      cookie,
      timeoutMs: 15_000,
    }),
  ]);
  if (!campaignsRes.ok) {
    console.error('[loadAdSpendExpenseFormData] listCampaigns failed', campaignsRes.status, campaignsRes.data);
  }
  if (!productsRes.ok) {
    console.error('[loadAdSpendExpenseFormData] products.list failed', productsRes.status, productsRes.data);
  }
  return {
    campaigns: parseCampaigns(campaignsRes),
    products: parseProducts(productsRes),
  };
}

export function parseLeaderboard(res: { ok: boolean; data: unknown }): LeaderboardEntry[] {
  const data = res.ok ? (res.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data : null;
  return data ?? [];
}

export function parseFundingRequests(res: { ok: boolean; data: unknown }): FundingRequestRecord[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: { records: FundingRequestRecord[] } } })?.result?.data;
  return data?.records ?? [];
}

export function parseFundingRequestsPage(res: { ok: boolean; data: unknown }): {
  records: FundingRequestRecord[];
  pagination: { page: number; limit: number; total: number };
} | null {
  if (!res.ok) return null;
  return (
    (res.data as {
      result?: {
        data?: {
          records: FundingRequestRecord[];
          pagination: { page: number; limit: number; total: number };
        };
      };
    })?.result?.data ?? null
  );
}

export function toDistributingFundingEntries(
  transfers: FundingRecord[],
  requests: FundingRequestRecord[],
): DistributingFundingEntry[] {
  // Build a quick lookup from request id → requester name so the resulting
  // "from request" chip on a transfer can show who originally asked.
  const requestById = new Map(requests.map((r) => [r.id, r] as const));

  const transferEntries: DistributingFundingEntry[] = transfers.map((record) => ({
    id: record.id,
    entryType: 'transfer',
    status: (record.status as 'SENT' | 'COMPLETED' | 'DISPUTED') ?? 'SENT',
    amount: record.amount,
    createdAt: record.sentAt,
    senderId: record.senderId,
    senderName: record.senderName ?? null,
    receiverId: record.receiverId,
    receiverName: record.receiverName ?? null,
    receiptUrl: record.receiptUrl ?? null,
    sourceFundingRequestId: record.sourceFundingRequestId ?? null,
    sourceRequesterName: record.sourceFundingRequestId
      ? requestById.get(record.sourceFundingRequestId)?.requesterName ?? null
      : null,
  }));

  // Deduplicate: any request that already has a matching transfer (via
  // `sourceFundingRequestId`) is now represented by that transfer in this feed,
  // so skip the request row. Pending / rejected requests still pass through.
  const linkedRequestIds = new Set(
    transfers
      .map((t) => t.sourceFundingRequestId)
      .filter((id): id is string => Boolean(id)),
  );

  const requestEntries: DistributingFundingEntry[] = requests
    .filter((record) => !linkedRequestIds.has(record.id))
    .map((record) => ({
      id: record.id,
      entryType: 'request',
      status: (record.status as 'PENDING' | 'APPROVED' | 'REJECTED') ?? 'PENDING',
      amount: record.amount,
      createdAt: record.createdAt,
      requesterId: record.requesterId,
      requesterName: record.requesterName ?? null,
      reason: record.reason ?? null,
      resolvedAt: record.resolvedAt ?? null,
      resolvedBy: record.resolvedBy ?? null,
      receiptUrl: record.receiptUrl ?? null,
    }));

  return [...transferEntries, ...requestEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function parseBalancesList(res: { ok: boolean; data: unknown }): FundingBalanceRow[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: FundingBalanceRow[] } })?.result?.data;
  return Array.isArray(data) ? data : [];
}

export interface MarketingDateFilterResult {
  startDate: string | undefined;
  endDate: string | undefined;
  periodAllTime: boolean;
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  leaderboardPeriod: 'this_month' | 'all_time';
}

type MarketingDefaultDatePreset = 'this_month' | 'last_48_hours' | 'today';

// YYYY-MM-DD in the company's operational TZ. Server-local `getFullYear/
// getMonth/getDate` resolves to the wrong Nigeria date around UTC midnight
// (server in UTC → at 00:00-01:00 WAT the "Today" filter became yesterday).
// Mirrors `toLocalDateString` in api.server.ts.
const NIGERIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function formatDateForQuery(date: Date): string {
  return NIGERIA_DATE_FORMATTER.format(date);
}

function defaultLast48HoursRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  return { startDate: formatDateForQuery(start), endDate: formatDateForQuery(end) };
}

function defaultTodayRange(): { startDate: string; endDate: string } {
  const today = formatDateForQuery(new Date());
  return { startDate: today, endDate: today };
}

export function resolveMarketingDateFilters(
  url: URL,
  defaultPreset: MarketingDefaultDatePreset = 'this_month',
): MarketingDateFilterResult {
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const range =
      defaultPreset === 'today'
        ? defaultTodayRange()
        : defaultPreset === 'last_48_hours'
          ? defaultLast48HoursRange()
          : defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  return {
    startDate,
    endDate,
    periodAllTime,
    filters: { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime },
    leaderboardPeriod,
  };
}

export function buildLeaderboardInput(
  startDate: string | undefined,
  endDate: string | undefined,
  periodAllTime: boolean,
): { period: 'this_month' | 'all_time'; startDate?: string; endDate?: string } {
  return {
    period: startDate && endDate ? 'this_month' : periodAllTime ? 'all_time' : 'this_month',
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };
}

export interface MarketingRoleFlags {
  /** Data-scoping flag — Media Buyers see only their own data. Stays role-shaped. */
  isMediaBuyer: boolean;
  /** Capability — can approve/reject funding requests AND record outgoing funding. */
  isFundingAdmin: boolean;
  /** Capability — can submit a funding request (MB → HoM, or HoM → Finance). */
  canRequestFunding: boolean;
  /** Capability — can approve or reject Media Buyer ad-spend submissions. */
  canApproveAdSpend: boolean;
}

/**
 * Phase 21: capability flags now honour permission codes alongside legacy roles
 * so a custom role template can grant just `marketing.funding.request` (or
 * `marketing.funding.approve` / `marketing.adSpend.approve`) without inheriting
 * MEDIA_BUYER / HEAD_OF_MARKETING / FINANCE_OFFICER wholesale.
 *
 * `isMediaBuyer` is intentionally NOT permission-driven — it's a data-scope flag
 * (filter queries to the buyer's own rows), not an authorization gate.
 */
export function getMarketingRoleFlags(
  user:
    | {
        role: string;
        permissions?: string[];
        isMarketingTeamSupervisorOnActiveBranch?: boolean;
        currentBranchId?: string | null;
      }
    | string,
): MarketingRoleFlags {
  const role = typeof user === 'string' ? user : user.role;
  const perms = typeof user === 'string' ? [] : user.permissions ?? [];
  const has = (code: string) => perms.includes(code) || perms.includes(canonicalPermissionCode(code));

  // Marketing-team supervisors are MEDIA_BUYERs by role but supervise a squad
  // on their active branch (`branch_team_members.is_supervisor = true`). CEO
  // directive 2026-05-11 — they should get the same funding-page chrome as
  // Head of Marketing for their team (distribute section, funding-admin
  // capability, request flow). The data scope itself stays enforced
  // server-side by the funding tRPC procedures.
  const isMarketingSupervisorOnBranch =
    typeof user !== 'string' &&
    user.isMarketingTeamSupervisorOnActiveBranch === true &&
    !!user.currentBranchId;

  const isMediaBuyer = role === 'MEDIA_BUYER' && !isMarketingSupervisorOnBranch;
  // SuperAdmin sees funding read-only — they should not approve/send/request
  // funding. They have all permission codes via snapshot but the funding
  // actions are not meant for them. Only HoM, Finance, Admin, or explicit
  // permission holders (excluding SuperAdmin).
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isFundingAdmin =
    !isSuperAdmin && (
      ['ADMIN', 'HEAD_OF_MARKETING', 'FINANCE_OFFICER'].includes(role) ||
      has('marketing.funding.approve') ||
      isMarketingSupervisorOnBranch
    );
  const canRequestFunding =
    !isSuperAdmin && (
      role === 'MEDIA_BUYER' ||
      role === 'HEAD_OF_MARKETING' ||
      has('marketing.funding.request') ||
      isMarketingSupervisorOnBranch
    );
  const canApproveAdSpend =
    ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'].includes(role) ||
    has('marketing.adSpend.approve') ||
    isMarketingSupervisorOnBranch;
  return { isMediaBuyer, isFundingAdmin, canRequestFunding, canApproveAdSpend };
}

export async function runMarketingFundingAction(cookie: string, formData: FormData) {
  const intent = formData.get('intent')?.toString();

  if (intent === 'createFunding') {
    const receiptUrl = formData.get('receiptUrl')?.toString() || undefined;
    const res = await apiRequest<unknown>('/trpc/marketing.createFunding', {
      method: 'POST',
      cookie,
      body: {
        receiverId: formData.get('receiverId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        ...(receiptUrl ? { receiptUrl } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create funding') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'verifyFunding') {
    const verifyAction = formData.get('action')?.toString() as 'COMPLETED' | 'DISPUTED';
    const disputeReason = formData.get('disputeReason')?.toString() || undefined;
    const res = await apiRequest<unknown>('/trpc/marketing.verifyFunding', {
      method: 'POST',
      cookie,
      body: {
        fundingId: formData.get('fundingId')?.toString() ?? '',
        action: verifyAction,
        disputeReason,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to verify funding') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'requestFunding') {
    const amount = formData.get('amount')?.toString() ?? '';
    if (!amount || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      return json({ error: 'Valid amount is required' }, { status: 400 });
    }
    const targetUserId = formData.get('targetUserId')?.toString().trim() || undefined;
    const res = await apiRequest<unknown>('/trpc/marketing.requestFunding', {
      method: 'POST',
      cookie,
      body: {
        amount: Number(amount),
        reason: formData.get('reason')?.toString() ?? '',
        ...(targetUserId ? { targetUserId } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to submit funding request') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    const amountRaw = formData.get('amount')?.toString() ?? '';
    const amount = Number(amountRaw);
    if (!requestId) {
      return json({ error: 'Request ID is required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: 'Valid approved amount is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.approveFundingRequest', {
      method: 'POST',
      cookie,
      body: { requestId, amount, ...(receiptUrl ? { receiptUrl } : {}) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve funding request') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'rejectFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    if (!requestId) {
      return json({ error: 'Request ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.rejectFundingRequest', {
      method: 'POST',
      cookie,
      body: {
        requestId,
        reason: formData.get('reason')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject funding request') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return null;
}

export async function runMarketingAdSpendAction(cookie: string, formData: FormData) {
  const intent = formData.get('intent')?.toString();

  if (intent === 'createAdSpend') {
    const screenshotUrl = formData.get('screenshotUrl')?.toString() ?? '';
    if (!screenshotUrl) {
      return json({ error: 'Screenshot URL is mandatory — no screenshot, no log entry' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.createAdSpend', {
      method: 'POST',
      cookie,
      body: {
        productId: formData.get('productId')?.toString() || undefined,
        campaignId: formData.get('campaignId')?.toString() || undefined,
        spendAmount: formData.get('spendAmount')?.toString() ?? '',
        screenshotUrl,
        spendDate: formData.get('spendDate')?.toString() ?? '',
        platform: formData.get('platform')?.toString() || undefined,
        platformCustomLabel: formData.get('platformCustomLabel')?.toString() || undefined,
        adUrl: formData.get('adUrl')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to log ad spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  /**
   * Multi-line "Add Expense" submission (CEO directive 2026-05-08). Single
   * campaignId at the batch level; each line carries `attributedOrderCount`
   * — the MB's manual split of the campaign's actual order count. Lines
   * arrive as a JSON-encoded string in `lines`.
   */
  if (intent === 'createAdSpendBatch') {
    const linesRaw = formData.get('lines')?.toString() ?? '';
    let lines: unknown;
    try {
      lines = JSON.parse(linesRaw);
    } catch {
      return json({ error: 'Invalid ads payload' }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return json({ error: 'Add at least one ad' }, { status: 400 });
    }
    const spendDate = formData.get('spendDate')?.toString() ?? '';
    if (!spendDate) {
      return json({ error: 'Date is required' }, { status: 400 });
    }
    const campaignId = formData.get('campaignId')?.toString() ?? '';
    if (!campaignId) {
      return json({ error: 'Form (campaign) is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.createAdSpendBatch', {
      method: 'POST',
      cookie,
      body: { spendDate, campaignId, lines },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to submit ad spend batch') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveAdSpend') {
    const adSpendId = formData.get('adSpendId')?.toString() ?? '';
    if (!adSpendId) {
      return json({ error: 'Ad spend ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.approveAdSpend', {
      method: 'POST',
      cookie,
      body: { adSpendId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve ad spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'rejectAdSpend') {
    const adSpendId = formData.get('adSpendId')?.toString() ?? '';
    if (!adSpendId) {
      return json({ error: 'Ad spend ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.rejectAdSpend', {
      method: 'POST',
      cookie,
      body: {
        adSpendId,
        reason: formData.get('reason')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject ad spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'logDailySpend') {
    const spendDate = formData.get('spendDate')?.toString() ?? '';
    const spendAmount = formData.get('spendAmount')?.toString() ?? '';
    if (!spendDate || !spendAmount) {
      return json({ error: 'Date and spend amount are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.logDailySpend', {
      method: 'POST',
      cookie,
      body: { spendDate, spendAmount: Number(spendAmount) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to log daily spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateDailySpend') {
    const adSpendId = formData.get('adSpendId')?.toString() ?? '';
    const spendAmount = formData.get('spendAmount')?.toString() ?? '';
    if (!adSpendId || !spendAmount) {
      return json({ error: 'Record ID and spend amount are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.updateDailySpend', {
      method: 'POST',
      cookie,
      body: { adSpendId, spendAmount: Number(spendAmount) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update daily spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateAdSpend') {
    const adSpendId = formData.get('adSpendId')?.toString() ?? '';
    const screenshotUrl = formData.get('screenshotUrl')?.toString() ?? '';
    if (!adSpendId || !screenshotUrl) {
      return json({ error: 'Ad spend ID and screenshot URL are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.updateAdSpend', {
      method: 'POST',
      cookie,
      body: {
        adSpendId,
        spendAmount: formData.get('spendAmount')?.toString() ?? '',
        screenshotUrl,
        spendDate: formData.get('spendDate')?.toString() ?? '',
        productId: formData.get('productId')?.toString() || undefined,
        campaignId: formData.get('campaignId')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update ad spend') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return null;
}

export { emptyMetrics };
