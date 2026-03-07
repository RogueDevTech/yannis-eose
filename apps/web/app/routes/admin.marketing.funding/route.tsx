import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { MarketingPage } from '~/features/marketing/MarketingPage';
import type {
  FundingRecord,
  FundingRequestRecord,
  AdSpendRecord,
  Metrics,
  LeaderboardEntry,
  User,
  Product,
  Campaign,
  MarketingStreamData,
  FundingBalance,
  FundingBalanceRow,
} from '~/features/marketing/types';

export const meta: MetaFunction = () => [
  { title: 'Marketing — Yannis EOSE' },
];

// ── Helpers to parse tRPC responses ────────────────────────────

function parseFunding(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: FundingRecord[]; pagination: { total: number } } } })?.result?.data ?? null;
}

function parseAdSpend(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: AdSpendRecord[]; totalSpend: string; pagination: { total: number } } } })?.result?.data ?? null;
}

function parseMetrics(res: { ok: boolean; data: unknown }): Metrics {
  const data = res.ok
    ? (res.data as { result?: { data?: Metrics } })?.result?.data
    : null;
  return data ?? { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
}

function parseFundingSummary(res: { ok: boolean; data: unknown }) {
  const data = res.ok
    ? (res.data as { result?: { data?: { totalSent: string; totalCompleted: string; totalDisputed: string } } })?.result?.data
    : null;
  return data ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
}

function parseUsers(res: { ok: boolean; data: unknown }): User[] {
  const data = res.ok
    ? (res.data as { result?: { data?: { users: User[] } } })?.result?.data
    : null;
  return data?.users ?? [];
}

function parseProducts(res: { ok: boolean; data: unknown }): Product[] {
  const data = res.ok
    ? (res.data as { result?: { data?: { products: Product[] } } })?.result?.data
    : null;
  return data?.products ?? [];
}

function parseCampaigns(res: { ok: boolean; data: unknown }): Campaign[] {
  const data = res.ok
    ? (res.data as { result?: { data?: { campaigns: Campaign[] } } })?.result?.data
    : null;
  return data?.campaigns ?? [];
}

function parseLeaderboard(res: { ok: boolean; data: unknown }): LeaderboardEntry[] {
  const data = res.ok
    ? (res.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data
    : null;
  return data ?? [];
}

function parseFundingRequests(res: { ok: boolean; data: unknown }): FundingRequestRecord[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: { records: FundingRequestRecord[] } } })?.result?.data;
  return data?.records ?? [];
}

function parseFundingBalance(res: { ok: boolean; data: unknown }): FundingBalance | null {
  if (!res.ok) return null;
  const data = (res.data as { result?: { data?: FundingBalance } })?.result?.data;
  return data ?? null;
}

function parseBalancesList(res: { ok: boolean; data: unknown }): FundingBalanceRow[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: FundingBalanceRow[] } })?.result?.data;
  return Array.isArray(data) ? data : [];
}

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  // Date filter (same pattern as dashboard/CEO)
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
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const isMediaBuyer = user.role === 'MEDIA_BUYER';
  const isFundingAdmin = ['SUPER_ADMIN', 'HEAD_OF_MARKETING', 'FINANCE_OFFICER'].includes(user.role);
  const canRequestFunding = isMediaBuyer || user.role === 'HEAD_OF_MARKETING';

  const fundingInput = JSON.stringify({
    page: 1,
    limit: 20,
    ...(isMediaBuyer ? { receiverId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });
  const adSpendInput = JSON.stringify({
    page: 1,
    limit: 20,
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });
  const metricsInput = JSON.stringify({
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });

  // Start fetches — Media Buyer does not need users list, funding summary, or leaderboard (no permission for summary)
  const fundingP = apiRequest<unknown>(`/trpc/marketing.listFunding?input=${encodeURIComponent(fundingInput)}`, { method: 'GET', cookie });
  const adSpendP = apiRequest<unknown>(`/trpc/marketing.listAdSpend?input=${encodeURIComponent(adSpendInput)}`, { method: 'GET', cookie });
  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, { method: 'GET', cookie });
  const campaignsInput = JSON.stringify(isMediaBuyer ? { mediaBuyerId: user.id, page: 1, limit: 20 } : { page: 1, limit: 20 });
  const campaignsP = apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${encodeURIComponent(campaignsInput)}`, { method: 'GET', cookie });

  // Admin-only: funding summary, users (for Send Funding dropdown), leaderboard
  const summaryP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { totalSent: '0', totalCompleted: '0', totalDisputed: '0' } } } });
  const usersP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { users: [] } } } });
  const leaderboardInput: { period: 'this_month' | 'all_time'; startDate?: string; endDate?: string } = {
    period: startDate && endDate ? 'this_month' : (periodAllTime ? 'all_time' : 'this_month'),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  ).catch(() => ({ ok: false, data: { result: { data: [] } } }));

  const productsP = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });

  // Balance(s): Media Buyer gets own balance; Admin gets list of recipient balances
  const myBalanceP = isMediaBuyer
    ? apiRequest<unknown>(`/trpc/marketing.getFundingBalance?input=${encodeURIComponent(JSON.stringify({ userId: user.id }))}`, { method: 'GET', cookie })
        .then((r) => parseFundingBalance(r) ?? { totalReceived: '0', totalSpend: '0', balance: '0' })
        .catch(() => ({ totalReceived: '0', totalSpend: '0', balance: '0' }))
    : undefined;
  const balancesListP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie })
        .then(parseBalancesList).catch((): FundingBalanceRow[] => [])
    : undefined;

  // Await only the CRITICAL data (tables that render immediately)
  const [fundingRes, adSpendRes, campaignsRes] = await Promise.all([
    fundingP,
    adSpendP,
    campaignsP,
  ]);

  const fundingData = parseFunding(fundingRes);
  const adSpendData = parseAdSpend(adSpendRes);

  let fundingRequests: FundingRequestRecord[] = [];
  if (isMediaBuyer) {
    const reqRes = await apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }))}`,
      { method: 'GET', cookie },
    );
    fundingRequests = parseFundingRequests(reqRes);
  } else if (isFundingAdmin) {
    const reqRes = await apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }))}`,
      { method: 'GET', cookie },
    );
    fundingRequests = parseFundingRequests(reqRes);
  }

  // Await all secondary data in parallel
  const [metrics, fundingSummary, leaderboard, usersData, productsData, myBalance, balancesList] = await Promise.all([
    metricsP.then(parseMetrics).catch((): Metrics => ({
      totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0,
    })),
    summaryP.then(parseFundingSummary).catch(() => ({
      totalSent: '0', totalCompleted: '0', totalDisputed: '0',
    })),
    leaderboardP.then((r) => parseLeaderboard(r)).catch((): LeaderboardEntry[] => []),
    usersP.then(parseUsers).catch((): User[] => []),
    productsP.then(parseProducts).catch((): Product[] => []),
    myBalanceP ?? Promise.resolve(undefined),
    balancesListP ?? Promise.resolve(undefined),
  ]);

  return {
    viewMode: isMediaBuyer ? ('media_buyer' as const) : ('admin' as const),
    currentUserId: user.id,
    canSendFunding: isFundingAdmin,
    canRequestFunding,
    funding: fundingData?.records ?? [],
    totalFunding: fundingData?.pagination?.total ?? 0,
    fundingRequests,
    adSpend: adSpendData?.records ?? [],
    totalAdSpend: adSpendData?.pagination?.total ?? 0,
    adSpendTotal: adSpendData?.totalSpend ?? '0',
    campaigns: parseCampaigns(campaignsRes),
    metrics,
    fundingSummary,
    leaderboard,
    users: usersData,
    products: productsData,
    leaderboardPeriod,
    filters,
    myBalance,
    balancesList,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingRoute() {
  const data = useLoaderData<typeof loader>();
  const { filters, viewMode, canSendFunding, canRequestFunding, ...streamData } = data as typeof data & { filters: { startDate: string; endDate: string; periodAllTime: boolean } };
  return (
    <MarketingPage
      {...(streamData as unknown as MarketingStreamData)}
      filters={filters}
      viewMode={viewMode}
      canSendFunding={canSendFunding}
      canRequestFunding={canRequestFunding}
    />
  );
}
