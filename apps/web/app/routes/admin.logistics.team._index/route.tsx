import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getSessionCookie,
  parsePerPage,
  requirePermissionOrRoles,
  redirectIfUnauthorized,
} from '~/lib/api.server';
import { resolveMarketingDateFilters } from '~/lib/marketing-pages.server';
import { LogisticsTeamPage } from '~/features/logistics/LogisticsTeamPage';
import { LogisticsTeamLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';
import type { LogisticsProviderRow, LogisticsLocationRow } from '~/features/logistics/team-types';

export const meta: MetaFunction = () => [
  { title: 'Logistics Agent Analysis — Yannis EOSE' },
];

function parseProvidersList(res: { ok: boolean; status: number; data: unknown }): LogisticsProviderRow[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: LogisticsProviderRow[] } | undefined;
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

function parseLocationsList(res: { ok: boolean; status: number; data: unknown }): LogisticsLocationRow[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: LogisticsLocationRow[] } | undefined;
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER'],
    permission: 'logistics.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);
  // URL-driven rows-per-page — the provider list is sliced client-side, so
  // `perPage` is both the slice size and the totalPages divisor.
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });

  const productId = url.searchParams.get('productId') || undefined;
  const logisticsTeamShell = { dateFilters: filters };

  const pageData = (async () => {
    const teamInput = {
      ...(periodAllTime
        ? { startDate: '2020-01-01', endDate: '2099-12-31' }
        : {
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
          }),
      ...(productId ? { productId } : {}),
    };

    const [teamRes, locRes, productsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/logistics.teamOverview?input=${encodeURIComponent(JSON.stringify(teamInput))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/logistics.locationOverview?input=${encodeURIComponent(JSON.stringify(teamInput))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`,
        { method: 'GET', cookie },
      ),
    ]);
    redirectIfUnauthorized(teamRes, url.pathname);
    const allProviders = parseProvidersList(teamRes);
    const allLocations = parseLocationsList(locRes);
    const productOptions: { id: string; name: string }[] = (() => {
      if (!productsRes.ok) return [];
      const raw = productsRes.data as Record<string, unknown> | undefined;
      const result = (raw?.result as { data?: { products?: Array<{ id: string; name: string }> } })?.data?.products;
      return Array.isArray(result) ? result.map((p) => ({ id: p.id, name: p.name })) : [];
    })();

    const SORT_BY_VALUES = new Set([
      'name',
      'assigned',
      'delivered',
      'unitsDelivered',
      'deliveryRate',
      'delinquencyRate',
      'returned',
      'locations',
    ]);
    const q = (url.searchParams.get('q') ?? '').trim();
    const qLower = q.toLowerCase();
    const sortByRaw = url.searchParams.get('sortBy') ?? 'assigned';
    const sortBy = SORT_BY_VALUES.has(sortByRaw) ? sortByRaw : 'assigned';
    const sortDirParam = url.searchParams.get('sortDir');
    const sortDir: 'asc' | 'desc' =
      sortDirParam === 'asc' || sortDirParam === 'desc'
        ? sortDirParam
        : sortBy === 'name'
          ? 'asc'
          : 'desc';

    const unfilteredCount = allProviders.length;
    let afterSearch = allProviders;
    if (qLower.length > 0) {
      afterSearch = allProviders.filter((p) => p.providerName.toLowerCase().includes(qLower));
    }

    const sorted = [...afterSearch];
    if (sortBy === 'name') {
      sorted.sort((a, b) => {
        const c = a.providerName.localeCompare(b.providerName, undefined, { sensitivity: 'base' });
        return sortDir === 'asc' ? c : -c;
      });
    } else {
      const num = (p: LogisticsProviderRow): number => {
        switch (sortBy) {
          case 'assigned':
            return p.totalAssigned;
          case 'delivered':
            return p.delivered;
          case 'unitsDelivered':
            return p.unitsDelivered;
          case 'deliveryRate':
            return p.deliveryRate;
          case 'delinquencyRate':
            return p.delinquencyRate;
          case 'returned':
            return p.returned;
          case 'locations':
            return p.locationCount;
          default:
            return 0;
        }
      };
      sorted.sort((a, b) => (sortDir === 'asc' ? num(a) - num(b) : num(b) - num(a)));
    }

    const PAGE_SIZE = perPage;
    const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
    const totalCount = sorted.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pagedProviders = sorted.slice(start, start + PAGE_SIZE);

    return {
      providers: pagedProviders,
      locations: allLocations,
      productOptions,
      productId: productId ?? null,
      dateFilters: filters,
      periodAllTime,
      page,
      totalPages,
      limit: PAGE_SIZE,
      totalCount,
      unfilteredCount,
      q,
      sortBy,
      sortDir,
    };
  })();

  return defer({ logisticsTeamShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function LogisticsTeamIndexRoute() {
  const { logisticsTeamShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<LogisticsTeamLoadingShell dateFilters={logisticsTeamShell.dateFilters} />}
      loaderShell={{ logisticsTeamShell }}
      deferredKey="pageData"
    >
      {(data) => (
          <LogisticsTeamPage
            providers={data.providers}
            locations={data.locations}
            productOptions={data.productOptions}
            productId={data.productId}
            dateFilters={data.dateFilters}
            page={data.page}
            totalPages={data.totalPages}
            limit={data.limit}
            totalCount={data.totalCount}
            unfilteredCount={data.unfilteredCount}
            q={data.q}
            sortBy={data.sortBy}
            sortDir={data.sortDir}
          />
        )}
    </CachedAwait>
  );
}
