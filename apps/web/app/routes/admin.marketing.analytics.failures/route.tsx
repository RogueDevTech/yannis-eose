import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { FormFailuresView, type FormFailuresData } from '~/features/marketing/FormFailuresPage';

export const meta: MetaFunction = () => [{ title: 'Form failures — Analytics — Yannis EOSE' }];

const EMPTY: FormFailuresData = {
  totals: { browserBlocked: 0, formBlocked: 0, serverRejected: 0, total: 0 },
  forms: [],
  topReasons: [],
};

export async function loader({ request }: LoaderFunctionArgs) {
  // The API re-checks: admin-level or full marketing team viewers (HoM) only.
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
  });
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultTodayRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const input = encodeURIComponent(JSON.stringify({ ...(startDate && { startDate }), ...(endDate && { endDate }) }));
  const failures = apiRequest<unknown>(`/trpc/marketing.submitFailures?input=${input}`, { method: 'GET', cookie }).then(
    (res) => (res.ok ? ((res.data as { result?: { data?: FormFailuresData } })?.result?.data ?? EMPTY) : EMPTY),
  );

  return defer({ filters: { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime }, failures });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FormFailuresRoute() {
  const { filters, failures } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Form failures"
        description="Submits that did not become an order, and why."
        backTo="/admin/marketing/analytics"
        mobileInlineActions
        actions={
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
            chrome="pill"
          />
        }
      />
      <MobileDateFilterRow startDate={filters.startDate} endDate={filters.endDate} periodAllTime={filters.periodAllTime} />
      <CachedAwait
        resolve={failures}
        deferredKey="failures"
        loaderShell={{ filters }}
        fallback={
          <div className="space-y-4" aria-busy="true">
            <OverviewStatStripSkeleton count={4} />
            <div className="card h-64 animate-pulse" />
          </div>
        }
      >
        {(data) => <FormFailuresView data={data as FormFailuresData} />}
      </CachedAwait>
    </div>
  );
}
