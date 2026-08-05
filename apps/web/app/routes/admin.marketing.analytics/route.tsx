import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultThisMonthRange } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { MarketingAnalyticsPage } from '~/features/marketing/MarketingAnalyticsPage';
import { MarketingAnalyticsLoadingShell } from '~/features/marketing/MarketingAnalyticsLoadingShell';
import type { FormAnalytics } from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Analytics — Yannis EOSE' }];

const EMPTY_ANALYTICS: FormAnalytics = {
  statStrip: { rawLandings: 0, uniqueLandings: 0, avgDwellMs: null, conversionRate: 0, attributionCoverage: 0 },
  funnel: { landed: 0, startedCart: 0, ordered: 0, delivered: 0 },
  timeSeries: [],
  topForms: [],
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
    const def = defaultThisMonthRange();
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
  return (
    <CachedAwait
      resolve={analyticsData}
      fallback={<MarketingAnalyticsLoadingShell filters={analyticsShell.filters} />}
      loaderShell={{ analyticsShell }}
      deferredKey="analyticsData"
    >
      {(payload) => <MarketingAnalyticsPage {...payload} filters={analyticsShell.filters} />}
    </CachedAwait>
  );
}
