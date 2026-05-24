import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultThisMonthRange } from '~/lib/api.server';
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

function parseStats(res: { ok: boolean; data: unknown }): CrossFunnelStats {
  if (!res.ok) return { totalAttempts: 0, uniqueCustomers: 0, perProduct: [] };
  const data = (res.data as { result?: { data?: CrossFunnelStats } })?.result?.data;
  return data ?? { totalAttempts: 0, uniqueCustomers: 0, perProduct: [] };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.read',
  });
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultThisMonthRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const productId = url.searchParams.get('productId') || undefined;

  const listInput = {
    page,
    limit: 20,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(productId && { productId }),
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
  };

  const crossFunnelShell = { filters };

  const listData = (async () => {
    const listRes = await apiRequest<unknown>(
      `/trpc/marketing.listMyCrossFunnelAttempts?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      { method: 'GET', cookie },
    );
    return { list: parseList(listRes) };
  })();

  const statsPromise = (async (): Promise<CrossFunnelStats> => {
    try {
      const statsRes = await apiRequest<unknown>(
        `/trpc/marketing.crossFunnelStats?input=${encodeURIComponent(JSON.stringify(statsInput))}`,
        { method: 'GET', cookie },
      );
      return parseStats(statsRes);
    } catch {
      return { totalAttempts: 0, uniqueCustomers: 0, perProduct: [] };
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
        <MarketingCrossFunnelPage list={d.list} secondary={statsPromise} filters={crossFunnelShell.filters} />
      )}
    </CachedAwait>
  );
}
