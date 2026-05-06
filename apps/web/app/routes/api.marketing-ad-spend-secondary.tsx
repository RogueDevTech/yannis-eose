import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS, getSessionCookie, requirePermission } from '~/lib/api.server';
import {
  buildLeaderboardInput,
  emptyMetrics,
  parseLeaderboard,
  parseMetrics,
  parseProducts,
  parseUsers,
} from '~/lib/marketing-pages.server';
import type { AdSpendGroup, LeaderboardEntry, Metrics, Product, User } from '~/features/marketing/types';

type SecondaryPayload = {
  metrics: Metrics;
  leaderboard: LeaderboardEntry[];
  users: User[];
  products: Product[];
  groups: AdSpendGroup[];
  groupsTotal: number;
  groupsPage: number;
  groupsTotalPages: number;
};

function emptyPayload(): SecondaryPayload {
  return {
    metrics: emptyMetrics(),
    leaderboard: [],
    users: [],
    products: [],
    groups: [],
    groupsTotal: 0,
    groupsPage: 1,
    groupsTotalPages: 1,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const startDate = url.searchParams.get('startDate') ?? undefined;
  const endDate = url.searchParams.get('endDate') ?? undefined;
  const periodAllTime = url.searchParams.get('periodAllTime') === 'true';
  const isMediaBuyer = url.searchParams.get('view') === 'media_buyer' || user.role === 'MEDIA_BUYER';

  const status = url.searchParams.get('status') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const productId = url.searchParams.get('productId') ?? undefined;
  const campaignId = url.searchParams.get('campaignId') ?? undefined;
  const mediaBuyerId = url.searchParams.get('mediaBuyerId') ?? undefined;

  const gpage = Math.max(1, parseInt(url.searchParams.get('gpage') || '1', 10));
  const userIdsJson = url.searchParams.get('userIds') ?? '[]';
  let userIds: string[] = [];
  try {
    const parsed = JSON.parse(userIdsJson) as unknown;
    if (Array.isArray(parsed)) {
      userIds = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 100);
    }
  } catch {
    userIds = [];
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  try {
    const groupedScope: Record<string, unknown> = {
      page: gpage,
      limit: 20,
      ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
      ...(startDate && !periodAllTime ? { startDate } : {}),
      ...(endDate && !periodAllTime ? { endDate } : {}),
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
      ...(productId ? { productId } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(mediaBuyerId ? { mediaBuyerId } : {}),
    };

    const metricsInput = JSON.stringify({
      ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
      ...(startDate && !periodAllTime ? { startDate } : {}),
      ...(endDate && !periodAllTime ? { endDate } : {}),
    });

    const leaderboardInput = buildLeaderboardInput(
      startDate && !periodAllTime ? startDate : undefined,
      endDate && !periodAllTime ? endDate : undefined,
      periodAllTime,
    );

    const productsP = apiRequest<unknown>('/trpc/products.list', opt);
    const campaignsP = isMediaBuyer
      ? apiRequest<unknown>(
          `/trpc/marketing.listCampaigns?input=${encodeURIComponent(
            JSON.stringify({ mediaBuyerId: user.id, page: 1, limit: 200 }),
          )}`,
          opt,
        )
      : Promise.resolve({ ok: false as const, data: null });

    const [metrics, leaderboard, users, productsRaw, groupedRes, campaignsRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, opt)
        .then(parseMetrics)
        .catch(() => emptyMetrics()),
      apiRequest<unknown>(
        `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
        opt,
      )
        .then((r) => parseLeaderboard(r))
        .catch(() => []),
      userIds.length > 0
        ? apiRequest<unknown>(
            `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ userIds, limit: 100 }))}`,
            opt,
          )
            .then(parseUsers)
            .catch(() => [])
        : Promise.resolve([] as User[]),
      productsP.then(parseProducts).catch(() => []),
      apiRequest<unknown>(
        `/trpc/marketing.listAdSpendGrouped?input=${encodeURIComponent(JSON.stringify(groupedScope))}`,
        opt,
      ),
      campaignsP,
    ]);

    // Media buyers only see products referenced by their campaigns.
    let products = productsRaw;
    if (isMediaBuyer) {
      const allowedProductIds = new Set<string>();
      const campaignsRaw =
        (campaignsRes.ok
          ? (campaignsRes.data as { result?: { data?: { campaigns?: Array<{ productIds?: string[] | null }> } } })
              ?.result?.data?.campaigns
          : []) ?? [];
      for (const c of campaignsRaw) {
        if (Array.isArray(c.productIds)) {
          for (const id of c.productIds) {
            if (id) allowedProductIds.add(id);
          }
        }
      }
      products = productsRaw.filter((p) => allowedProductIds.has(p.id));
    }

    type GroupedShape = {
      groups?: Array<{
        spendDate: string;
        mediaBuyerId: string;
        mediaBuyerName: string | null;
        lineCount: number;
        totalAmount: string;
        rolledStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MIXED';
        overallOrderCount?: number;
        overallCpa?: number | null;
        lines: Array<{
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
          platform: 'FACEBOOK' | 'TIKTOK' | 'GOOGLE' | 'OTHER';
          platformCustomLabel?: string | null;
          spendDate: string;
          status: 'PENDING' | 'APPROVED' | 'REJECTED';
          rejectionReason: string | null;
          approvedAt: string | null;
          rejectedAt: string | null;
          createdAt: string;
          orderCount?: number;
          indicativeCpa?: number | null;
        }>;
      }>;
      pagination?: { page: number; limit: number; total: number };
    };

    const groupedData: GroupedShape = groupedRes.ok
      ? (((groupedRes.data as { result?: { data?: GroupedShape } })?.result?.data) ?? {})
      : {};
    const resolvedGpage = groupedRes.ok ? (groupedData.pagination?.page ?? gpage) : gpage;

    const groups = (groupedData.groups ?? []).map((g) => ({
      ...g,
      overallOrderCount: g.overallOrderCount ?? 0,
      overallCpa: g.overallCpa ?? null,
      lines: (g.lines ?? []).map((l) => ({
        ...l,
        orderCount: l.orderCount ?? 0,
        indicativeCpa: l.indicativeCpa ?? null,
      })),
    }));
    const groupsTotal = groupedData.pagination?.total ?? 0;
    const groupsTotalPages = Math.max(1, Math.ceil(groupsTotal / 20));

    const payload: SecondaryPayload = {
      metrics,
      leaderboard,
      users,
      products,
      groups,
      groupsTotal,
      groupsPage: resolvedGpage,
      groupsTotalPages,
    };
    return secondaryCacheJson({ ok: true as const, ...payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Secondary load failed';
    return json({ ok: false as const, error: msg, ...emptyPayload() });
  }
}

