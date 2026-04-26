import { json } from '@remix-run/node';
import { apiRequest, defaultThisMonthRange, safeStatus } from '~/lib/api.server';
import type {
  AdSpendRecord,
  AdSpendStatusCounts,
  Campaign,
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
  ALL: 0,
});

export function parseAdSpendStatusCounts(res: { ok: boolean; data: unknown }): AdSpendStatusCounts {
  if (!res.ok) return emptyAdSpendStatusCounts();
  const data = (res.data as { result?: { data?: AdSpendStatusCounts } })?.result?.data;
  return data ?? emptyAdSpendStatusCounts();
}

const emptyMetrics = (): Metrics => ({
  totalSpend: 0,
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

/** COMPLETED funding received minus APPROVED ad spend (same as `marketing.getFundingBalance`). */
export function parseFundingBalance(res: { ok: boolean; data: unknown }):
  | { totalReceived: string; totalSpend: string; balance: string }
  | undefined {
  if (!res.ok) return undefined;
  const data = (res.data as {
    result?: { data?: { totalReceived: string; totalSpend: string; balance: string } };
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

export function resolveMarketingDateFilters(url: URL): MarketingDateFilterResult {
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
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
  isMediaBuyer: boolean;
  isFundingAdmin: boolean;
  canRequestFunding: boolean;
}

export function getMarketingRoleFlags(role: string): MarketingRoleFlags {
  const isMediaBuyer = role === 'MEDIA_BUYER';
  const isFundingAdmin = ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'FINANCE_OFFICER'].includes(role);
  const canRequestFunding = isMediaBuyer || role === 'HEAD_OF_MARKETING';
  return { isMediaBuyer, isFundingAdmin, canRequestFunding };
}

export async function runMarketingFundingAction(cookie: string, formData: FormData) {
  const intent = formData.get('intent')?.toString();

  if (intent === 'createFunding') {
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    if (!receiptUrl) {
      return json({ error: 'Receipt URL is mandatory' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.createFunding', {
      method: 'POST',
      cookie,
      body: {
        receiverId: formData.get('receiverId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        receiptUrl,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create funding' }, { status: safeStatus(res.status) });
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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to verify funding' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'requestFunding') {
    const amount = formData.get('amount')?.toString() ?? '';
    if (!amount || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      return json({ error: 'Valid amount is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.requestFunding', {
      method: 'POST',
      cookie,
      body: {
        amount: Number(amount),
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to submit funding request' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    if (!requestId || !receiptUrl) {
      return json({ error: 'Request ID and receipt image are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.approveFundingRequest', {
      method: 'POST',
      cookie,
      body: { requestId, receiptUrl },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to approve funding request' }, { status: safeStatus(res.status) });
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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reject funding request' }, { status: safeStatus(res.status) });
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
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to log ad spend' }, { status: safeStatus(res.status) });
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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to approve ad spend' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return null;
}

export { emptyMetrics };
