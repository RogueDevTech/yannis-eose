import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingPage } from '~/features/marketing/MarketingPage';
import type {
  FundingRecord,
  AdSpendRecord,
  Metrics,
  LeaderboardEntry,
  User,
  Product,
  Campaign,
  MarketingStreamData,
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

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  // Start ALL fetches concurrently — none blocks the others
  const fundingP = apiRequest<unknown>('/trpc/marketing.listFunding', { method: 'GET', cookie });
  const adSpendP = apiRequest<unknown>('/trpc/marketing.listAdSpend', { method: 'GET', cookie });
  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({}))}`, { method: 'GET', cookie });
  const summaryP = apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie });
  const usersP = apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie });
  const productsP = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });
  const campaignsP = apiRequest<unknown>('/trpc/marketing.listCampaigns', { method: 'GET', cookie });
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  );

  // Await only the CRITICAL data (tables that render immediately)
  const [fundingRes, adSpendRes, campaignsRes] = await Promise.all([
    fundingP,
    adSpendP,
    campaignsP,
  ]);

  const fundingData = parseFunding(fundingRes);
  const adSpendData = parseAdSpend(adSpendRes);

  // Return plain object — v3_singleFetch streams un-awaited promises automatically
  return {
    // Critical (resolved immediately)
    funding: fundingData?.records ?? [],
    totalFunding: fundingData?.pagination?.total ?? 0,
    adSpend: adSpendData?.records ?? [],
    totalAdSpend: adSpendData?.pagination?.total ?? 0,
    adSpendTotal: adSpendData?.totalSpend ?? '0',
    campaigns: parseCampaigns(campaignsRes),

    // Deferred (streamed to client as they resolve)
    metrics: metricsP.then(parseMetrics).catch((): Metrics => ({
      totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0,
    })),
    fundingSummary: summaryP.then(parseFundingSummary).catch(() => ({
      totalSent: '0', totalCompleted: '0', totalDisputed: '0',
    })),
    leaderboard: leaderboardP.then(parseLeaderboard).catch((): LeaderboardEntry[] => []),
    users: usersP.then(parseUsers).catch((): User[] => []),
    products: productsP.then(parseProducts).catch((): Product[] => []),
    leaderboardPeriod,
  } satisfies MarketingStreamData;
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
      return json({ error: errorData?.error?.message ?? 'Failed to create funding' }, { status: res.status });
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
      return json({ error: errorData?.error?.message ?? 'Failed to verify funding' }, { status: res.status });
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
      return json({ error: errorData?.error?.message ?? 'Failed to log ad spend' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingPage {...(data as unknown as MarketingStreamData)} />;
}
