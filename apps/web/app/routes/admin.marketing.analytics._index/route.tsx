import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { usePageRefreshOnEvent, usePollingFallback, useLivePoll } from '~/hooks/useSocket';
import { MarketingAnalyticsPage } from '~/features/marketing/MarketingAnalyticsPage';
import { MarketingAnalyticsLoadingShell } from '~/features/marketing/MarketingAnalyticsLoadingShell';
import type { FormAnalytics } from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Analytics — Yannis EOSE' }];

// Live events that should refetch the analytics bundle. `form:view` is emitted by
// the edge beacon on every landing/dwell; `order:new` covers conversions.
const ANALYTICS_LIVE_EVENTS = ['form:view', 'order:new'] as const;

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
  // MB sees own forms; HoM/admin see the branch; marketing team supervisors see
  // their team. Server-side (formAnalyticsPageBundle) re-enforces the exact scope.
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
    return { analytics: data ?? EMPTY_ANALYTICS };
  });

  const analyticsShell = {
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
  };

  return defer({ analyticsShell, analyticsData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingAnalyticsRoute() {
  const { analyticsShell, analyticsData } = useLoaderData<typeof loader>();
  // Live: refetch on form:view / order:new socket events; poll as a fallback when
  // the socket is down (background tabs, PWA waking).
  usePageRefreshOnEvent([...ANALYTICS_LIVE_EVENTS]);
  usePollingFallback(20_000);
  // Always-on refresh: guarantees the live page updates even if a socket event is
  // missed (connected-but-event-not-delivered), independent of socket state.
  useLivePoll(15_000);
  return (
    <CachedAwait
      resolve={analyticsData}
      fallback={<MarketingAnalyticsLoadingShell filters={analyticsShell.filters} />}
      loaderShell={{ analyticsShell }}
      deferredKey="analyticsData"
      // Live page: revalidates on a silent interval + socket events. The LIVE
      // indicator already signals the refresh, so don't dim the whole page each tick.
      dimOnRefresh={false}
    >
      {(payload) => (
        <MarketingAnalyticsPage
          {...payload}
          filters={analyticsShell.filters}
          liveEvents={[...ANALYTICS_LIVE_EVENTS]}
        />
      )}
    </CachedAwait>
  );
}
