import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  redirectIfUnauthorized,
} from '~/lib/api.server';
import { resolveMarketingDateFilters } from '~/lib/marketing-pages.server';
import { LogisticsTeamPage } from '~/features/logistics/LogisticsTeamPage';
import { LogisticsTeamLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';
import type { LogisticsProviderRow } from '~/features/logistics/team-types';

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

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS'],
    permission: 'logistics.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);

  const logisticsTeamShell = { dateFilters: filters };

  const pageData = (async () => {
    const teamInput = {
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    const teamRes = await apiRequest<unknown>(
      `/trpc/logistics.teamOverview?input=${encodeURIComponent(JSON.stringify(teamInput))}`,
      { method: 'GET', cookie },
    );
    redirectIfUnauthorized(teamRes, url.pathname);
    const allProviders = parseProvidersList(teamRes);

    const SORT_BY_VALUES = new Set([
      'name',
      'assigned',
      'delivered',
      'deliveryRate',
      'delinquencyRate',
      'returned',
      'locations',
    ]);
    const q = (url.searchParams.get('q') ?? '').trim();
    const qLower = q.toLowerCase();
    const sortByRaw = url.searchParams.get('sortBy') ?? 'deliveryRate';
    const sortBy = SORT_BY_VALUES.has(sortByRaw) ? sortByRaw : 'deliveryRate';
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

    const PAGE_SIZE = 20;
    const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
    const totalCount = sorted.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pagedProviders = sorted.slice(start, start + PAGE_SIZE);

    return {
      providers: pagedProviders,
      dateFilters: filters,
      periodAllTime,
      page,
      totalPages,
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
            dateFilters={data.dateFilters}
            page={data.page}
            totalPages={data.totalPages}
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
