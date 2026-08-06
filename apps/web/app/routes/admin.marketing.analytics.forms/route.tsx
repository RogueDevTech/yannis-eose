import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { FormsTable } from '~/features/marketing/MarketingAnalyticsPage';
import type { FormAnalytics } from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'All forms — Analytics — Yannis EOSE' }];

const EMPTY_ANALYTICS: FormAnalytics = {
  statStrip: { rawLandings: 0, uniqueLandings: 0, avgDwellMs: null, conversionRate: 0, attributionCoverage: 0 },
  funnel: { formViews: 0, startedCart: 0, ordered: 0, confirmed: 0, delivered: 0 },
  trendUnit: 'day',
  timeSeries: [],
  topForms: [],
  forms: [],
  crossFunnel: { totalAttempts: 0, uniqueCustomers: 0, resubmissions: 0, sameMb: 0, crossFunnel: 0, perProduct: [] },
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Same scope as the analytics overview — the bundle re-enforces it server-side.
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.teamOverview',
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

  const bundleInput = encodeURIComponent(
    JSON.stringify({
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
    }),
  );
  const analyticsData = apiRequest<unknown>(
    `/trpc/marketing.formAnalyticsPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie },
  ).then((res) => {
    const data = res.ok
      ? ((res.data as { result?: { data?: FormAnalytics } })?.result?.data ?? null)
      : null;
    return { forms: (data ?? EMPTY_ANALYTICS).forms };
  });

  const filters = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
  };

  return defer({ filters, analyticsData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function AllFormsRoute() {
  const { filters, analyticsData } = useLoaderData<typeof loader>();

  const backHref = (() => {
    const params = new URLSearchParams();
    if (filters.periodAllTime) params.set('period', 'all_time');
    else {
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
    }
    const qs = params.toString();
    return `/admin/marketing/analytics${qs ? `?${qs}` : ''}`;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title="All forms"
        description="Every form with its views, conversion, and average time. Tap a form for its own analytics."
        backTo={backHref}
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

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <CachedAwait
        resolve={analyticsData}
        deferredKey="analyticsData"
        loaderShell={{ filters }}
        fallback={<AllFormsSkeleton />}
      >
        {(data) => <FormsTable forms={data.forms} filters={filters} />}
      </CachedAwait>
    </div>
  );
}

/** Skeleton matching the All-forms table (toolbar: heading + sort + search; then rows). */
function AllFormsSkeleton() {
  const pulse = (cls: string) => <div className={`rounded bg-app-hover animate-pulse ${cls}`} />;
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {/* Toolbar: title/subtitle on the left, sort + search on the right. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div className="space-y-1.5">
          {pulse('h-4 w-24')}
          {pulse('h-3 w-56')}
        </div>
        <div className="flex items-center gap-2">
          {pulse('h-9 w-40')}
          {pulse('h-9 w-9')}
        </div>
      </div>
      {/* Table: header row + body rows. */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-4 px-3 py-2 border-b border-app-border">
          {pulse('h-3 flex-1 max-w-[9rem]')}
          {pulse('h-3 w-16')}
          {pulse('h-3 w-14')}
          {pulse('h-3 w-12')}
          {pulse('h-3 w-14')}
          {pulse('h-3 w-14')}
          {pulse('h-3 w-12')}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-app-border last:border-0">
            {pulse('h-4 flex-1 max-w-[9rem]')}
            {pulse('h-4 w-16')}
            {pulse('h-4 w-14')}
            {pulse('h-4 w-12')}
            {pulse('h-4 w-14')}
            {pulse('h-4 w-14')}
            {pulse('h-6 w-14 rounded-md')}
          </div>
        ))}
      </div>
    </div>
  );
}
