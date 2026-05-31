import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  parsePerPage,
  requirePermission,
} from '~/lib/api.server';
import {
  emptyMetrics,
  parseMetrics,
  parseProducts,
  parseUsers,
} from '~/lib/marketing-pages.server';
import type { AdSpendGroup, Metrics, Product, User } from '~/features/marketing/types';

type SecondaryPayload = {
  metrics: Metrics;
  users: User[];
  products: Product[];
  groups: AdSpendGroup[];
  groupsTotal: number;
  groupsPage: number;
  groupsTotalPages: number;
  otherExpensesCounts: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number; totalSpend: number; pendingSpend: number };
};

function emptyPayload(): SecondaryPayload {
  return {
    metrics: emptyMetrics(),
    users: [],
    products: [],
    groups: [],
    groupsTotal: 0,
    groupsPage: 1,
    groupsTotalPages: 1,
    otherExpensesCounts: { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0, totalSpend: 0 },
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
  const category = url.searchParams.get('category') || 'AD_SPEND';
  const search = url.searchParams.get('search') ?? undefined;
  const productId = url.searchParams.get('productId') ?? undefined;
  const campaignId = url.searchParams.get('campaignId') ?? undefined;
  const mediaBuyerId = url.searchParams.get('mediaBuyerId') ?? undefined;

  const gpage = Math.max(1, parseInt(url.searchParams.get('gpage') || '1', 10));
  // Daily-grouped accordion's URL-driven rows-per-page (`?gPerPage=`).
  const { perPage: groupsPerPage } = parsePerPage(url.searchParams, { param: 'gPerPage' });
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
      limit: groupsPerPage,
      ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
      ...(startDate && !periodAllTime ? { startDate } : {}),
      ...(endDate && !periodAllTime ? { endDate } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
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

    const productsListInput = encodeURIComponent(
      JSON.stringify({
        page: 1,
        limit: 100,
        status: 'ACTIVE',
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    );
    const productsP = apiRequest<unknown>(`/trpc/products.list?input=${productsListInput}`, {
      ...opt,
      timeoutMs: 15_000,
    });
    const campaignsP = isMediaBuyer
      ? apiRequest<unknown>(
          `/trpc/marketing.listCampaigns?input=${encodeURIComponent(
            JSON.stringify({ mediaBuyerId: user.id, page: 1, limit: 200 }),
          )}`,
          opt,
        )
      : Promise.resolve({ ok: false as const, data: null });

    // Fetch status counts + total spend for non-AD_SPEND categories (always, for the "Other Expenses" overview)
    const otherCategories = ['AD_ACCOUNT', 'RECRUITMENT_AD', 'WHATSAPP_CAMPAIGN', 'UGC_PRODUCTION'] as const;
    const otherBaseScope = {
      ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
      ...(startDate && !periodAllTime ? { startDate } : {}),
      ...(endDate && !periodAllTime ? { endDate } : {}),
    };
    const otherCountsP = Promise.all(
      otherCategories.map((cat) =>
        Promise.all([
          apiRequest<unknown>(
            `/trpc/marketing.adSpendStatusCounts?input=${encodeURIComponent(JSON.stringify({ ...otherBaseScope, category: cat }))}`,
            { ...opt, timeoutMs: 10_000 },
          ).then((res) => {
            if (!res.ok) return { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
            const d = (res.data as { result?: { data?: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number } } })?.result?.data;
            return d ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
          }).catch(() => ({ PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 })),
          // Approved spend total
          apiRequest<unknown>(
            `/trpc/marketing.listAdSpend?input=${encodeURIComponent(JSON.stringify({ ...otherBaseScope, category: cat, status: 'APPROVED', page: 1, limit: 1 }))}`,
            { ...opt, timeoutMs: 10_000 },
          ).then((res) => {
            if (!res.ok) return 0;
            const d = (res.data as { result?: { data?: { totalSpend?: string } } })?.result?.data;
            return Number(d?.totalSpend ?? 0);
          }).catch(() => 0),
          // Pending spend total
          apiRequest<unknown>(
            `/trpc/marketing.listAdSpend?input=${encodeURIComponent(JSON.stringify({ ...otherBaseScope, category: cat, status: 'PENDING', page: 1, limit: 1 }))}`,
            { ...opt, timeoutMs: 10_000 },
          ).then((res) => {
            if (!res.ok) return 0;
            const d = (res.data as { result?: { data?: { totalSpend?: string } } })?.result?.data;
            return Number(d?.totalSpend ?? 0);
          }).catch(() => 0),
        ]),
      ),
    ).then((results) => {
      let counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
      let totalSpend = 0;
      let pendingSpend = 0;
      for (const [c, approved, pending] of results) {
        counts = { PENDING: counts.PENDING + c.PENDING, APPROVED: counts.APPROVED + c.APPROVED, REJECTED: counts.REJECTED + c.REJECTED, ALL: counts.ALL + c.ALL };
        totalSpend += approved;
        pendingSpend += pending;
      }
      return { ...counts, totalSpend, pendingSpend };
    });

    const [metrics, users, productsRaw, groupedRes, campaignsRes, otherExpensesCounts] = await Promise.all([
      apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, opt)
        .then(parseMetrics)
        .catch(() => emptyMetrics()),
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
      otherCountsP,
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
    const groupsTotalPages = Math.max(1, Math.ceil(groupsTotal / groupsPerPage));

    const payload: SecondaryPayload = {
      metrics,
      users,
      products,
      groups,
      groupsTotal,
      groupsPage: resolvedGpage,
      groupsTotalPages,
      otherExpensesCounts,
    };
    return secondaryCacheJson({ ok: true as const, ...payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Secondary load failed';
    return json({ ok: false as const, error: msg, ...emptyPayload() });
  }
}

