import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { MarketingCrossFunnelPage } from '~/features/marketing/MarketingCrossFunnelPage';
import { MarketingCrossFunnelLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type {
  CrossFunnelAttemptRow,
  CrossFunnelStats,
} from '~/features/marketing/MarketingCrossFunnelPage';
import { useMultiDeferredCacheSync } from '~/hooks/useMultiDeferredCacheSync';

export const meta: MetaFunction = () => [
  { title: 'Cross-funnel — Yannis EOSE' },
];

function parseList(res: { ok: boolean; data: unknown }) {
  if (!res.ok) {
    return { rows: [] as CrossFunnelAttemptRow[], total: 0, page: 1, limit: 20, totalPages: 0 };
  }
  const data = (res.data as { result?: { data?: { rows?: CrossFunnelAttemptRow[]; total?: number; page?: number; limit?: number; totalPages?: number } } })?.result?.data;
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    limit: data?.limit ?? 20,
    totalPages: data?.totalPages ?? 0,
  };
}

const EMPTY_CROSS_FUNNEL_STATS: CrossFunnelStats = {
  totalAttempts: 0,
  uniqueCustomers: 0,
  perProduct: [],
  resubmissions: 0,
  sameMb: 0,
  crossFunnel: 0,
};

function parseStats(res: { ok: boolean; data: unknown }): CrossFunnelStats {
  if (!res.ok) return EMPTY_CROSS_FUNNEL_STATS;
  const data = (res.data as { result?: { data?: CrossFunnelStats } })?.result?.data;
  return data ?? EMPTY_CROSS_FUNNEL_STATS;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.read',
    orMarketingTeamSupervisorOnBranch: true,
  });
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultTodayRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const productId = url.searchParams.get('productId') || undefined;
  const campaignId = url.searchParams.get('campaignId') || undefined;
  const mediaBuyerId = url.searchParams.get('mediaBuyerId') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const duplicateType = url.searchParams.get('duplicateType') || undefined;

  const listInput = {
    page,
    limit: 20,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(productId && { productId }),
    ...(campaignId && { campaignId }),
    ...(mediaBuyerId && { mediaBuyerId: mediaBuyerId }),
    ...(search && { search }),
    ...(duplicateType && { duplicateType }),
  };
  const statsInput = {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };

  const filters = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
    productId: productId ?? '',
    campaignId: campaignId ?? '',
    mediaBuyerId: mediaBuyerId ?? '',
    search: search ?? '',
    duplicateType: duplicateType ?? '',
  };

  // Show MB filter for admin-class, HoM, and marketing supervisors. Computed
  // synchronously (not inside the deferred listData promise) so the loading
  // shell can render the correct number of filter-select placeholders.
  const showMbFilter =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT' ||
    user.role === 'HEAD_OF_MARKETING' ||
    (user.role === 'MEDIA_BUYER' && user.isMarketingTeamSupervisorOnActiveBranch === true);

  const crossFunnelShell = { filters, showMbFilter };

  const listData = (async () => {
    const [listRes, productsRes, campaignsRes, buyersRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/marketing.listMyCrossFunnelAttempts?input=${encodeURIComponent(JSON.stringify(listInput))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 200 }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/marketing.listCampaigns?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 200, status: 'ACTIVE' }))}`,
        { method: 'GET', cookie },
      ),
      showMbFilter
        ? apiRequest<unknown>(
            `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 200, role: 'MEDIA_BUYER', status: 'ACTIVE' }))}`,
            { method: 'GET', cookie },
          )
        : Promise.resolve({ ok: false, data: {} } as { ok: boolean; data: unknown }),
    ]);
    let productsForFilter: Array<{ id: string; name: string }> = [];
    if (productsRes.ok) {
      const pData = productsRes.data as { result?: { data?: { products?: Array<{ id: string; name: string }> } } };
      productsForFilter = (pData?.result?.data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
    }
    let campaignsForFilter: Array<{ id: string; name: string }> = [];
    if (campaignsRes.ok) {
      const cData = campaignsRes.data as { result?: { data?: { campaigns?: Array<{ id: string; name: string }> } } };
      campaignsForFilter = (cData?.result?.data?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name }));
    }
    let mediaBuyersForFilter: Array<{ id: string; name: string }> = [];
    if (buyersRes.ok) {
      const bData = buyersRes.data as { result?: { data?: { users?: Array<{ id: string; name: string }> } } };
      mediaBuyersForFilter = (bData?.result?.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }));
    }
    return { list: parseList(listRes), productsForFilter, campaignsForFilter, mediaBuyersForFilter, showMbFilter };
  })();

  const statsPromise = (async (): Promise<CrossFunnelStats> => {
    try {
      const statsRes = await apiRequest<unknown>(
        `/trpc/marketing.crossFunnelStats?input=${encodeURIComponent(JSON.stringify(statsInput))}`,
        { method: 'GET', cookie },
      );
      return parseStats(statsRes);
    } catch {
      return EMPTY_CROSS_FUNNEL_STATS;
    }
  })();

  return defer({
    crossFunnelShell,
    listData,
    statsPromise,
  });
}


export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function CrossFunnelRoute() {
  const { crossFunnelShell, listData, statsPromise } = useLoaderData<typeof loader>();
  useMultiDeferredCacheSync({
    shell: { crossFunnelShell },
    deferred: { listData, statsPromise },
  });
  return (
    <CachedAwait resolve={listData} fallback={<MarketingCrossFunnelLoadingShell {...crossFunnelShell} />}>
      {(d) => (
        <MarketingCrossFunnelPage
          list={d.list}
          secondary={statsPromise}
          filters={crossFunnelShell.filters}
          productsForFilter={d.productsForFilter}
          campaignsForFilter={d.campaignsForFilter}
          mediaBuyersForFilter={d.mediaBuyersForFilter}
          showMbFilter={d.showMbFilter}
        />
      )}
    </CachedAwait>
  );
}
