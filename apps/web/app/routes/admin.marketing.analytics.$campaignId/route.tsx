import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { usePageRefreshOnEvent, usePollingFallback, useLivePoll } from '~/hooks/useSocket';
import { MarketingAnalyticsPage } from '~/features/marketing/MarketingAnalyticsPage';
import { MarketingAnalyticsLoadingShell } from '~/features/marketing/MarketingAnalyticsLoadingShell';
import type { FormAnalytics } from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Form Analytics — Yannis EOSE' }];

const ANALYTICS_LIVE_EVENTS = ['form:view', 'order:new'] as const;

const EMPTY_ANALYTICS: FormAnalytics = {
  statStrip: { rawLandings: 0, uniqueLandings: 0, avgDwellMs: null, conversionRate: 0, attributionCoverage: 0 },
  funnel: { formViews: 0, startedCart: 0, ordered: 0, confirmed: 0, delivered: 0 },
  timeSeries: [],
  topForms: [],
  forms: [],
  crossFunnel: { totalAttempts: 0, uniqueCustomers: 0, resubmissions: 0, sameMb: 0, crossFunnel: 0, perProduct: [] },
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  });
  const cookie = getSessionCookie(request);
  const campaignId = params.campaignId ?? '';

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
      campaignId,
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
    const analytics = data ?? EMPTY_ANALYTICS;
    // The form's label: the campaign's own row is the only form in this scoped bundle.
    const formLabel =
      analytics.forms[0]?.label ?? analytics.topForms[0]?.label ?? 'Form';
    return { analytics, formLabel };
  });

  const analyticsShell = {
    campaignId,
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

export default function MarketingFormAnalyticsRoute() {
  const { analyticsShell, analyticsData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...ANALYTICS_LIVE_EVENTS]);
  usePollingFallback(20_000);
  useLivePoll(15_000);
  return (
    <CachedAwait
      resolve={analyticsData}
      fallback={<MarketingAnalyticsLoadingShell filters={analyticsShell.filters} detail />}
      loaderShell={{ analyticsShell }}
      deferredKey="analyticsData"
      // Live page: revalidates on a silent interval + socket events. The LIVE
      // indicator already signals the refresh, so don't dim the whole page each tick.
      dimOnRefresh={false}
    >
      {(payload) => (
        <MarketingAnalyticsPage
          analytics={payload.analytics}
          filters={analyticsShell.filters}
          liveEvents={[...ANALYTICS_LIVE_EVENTS]}
          detail={{ campaignId: analyticsShell.campaignId, formLabel: payload.formLabel }}
        />
      )}
    </CachedAwait>
  );
}
