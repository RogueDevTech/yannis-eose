import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { DeferredError } from '~/components/ui/deferred-section';
import { MarketingAdSpendPage } from '~/features/marketing/MarketingAdSpendPage';
import { MarketingAdSpendLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type { AdSpendStatusCounts, AdSpendStatusFilter, Campaign, MarketingAdSpendLoaderData } from '~/features/marketing/types';
import {
  buildLeaderboardInput,
  getMarketingRoleFlags,
  parseAdSpend,
  resolveMarketingDateFilters,
  runMarketingAdSpendAction,
} from '~/lib/marketing-pages.server';

const AD_SPEND_PER_PAGE = 20;
const AD_SPEND_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const meta: MetaFunction = () => [{ title: 'Ads Expense — Marketing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  // Default to "this month" — matches every other marketing page (Overview, Team,
  // Orders, Leaderboard, Funding). The previous `last_48_hours` default hid every
  // entry older than 2 days, so users landing on the page from the sidebar saw
  // ₦0 even when their period had real spend.
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const { isMediaBuyer, isFundingAdmin, canApproveAdSpend } = getMarketingRoleFlags(user);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const searchRaw = url.searchParams.get('search')?.trim();
  const searchFilter = searchRaw && searchRaw.length > 0 ? searchRaw : undefined;
  const statusParam = url.searchParams.get('status') ?? undefined;
  const statusFilter: AdSpendStatusFilter | undefined =
    statusParam && (AD_SPEND_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as AdSpendStatusFilter)
      : undefined;
  // UUIDv7 is hex-with-dashes; cheap regex avoids passing garbage through to the API.
  const productIdParam = url.searchParams.get('productId')?.trim();
  const productIdFilter = productIdParam && /^[0-9a-f-]{32,36}$/i.test(productIdParam)
    ? productIdParam
    : undefined;
  const campaignIdParam = url.searchParams.get('campaignId')?.trim();
  const campaignIdFilter = campaignIdParam && /^[0-9a-f-]{32,36}$/i.test(campaignIdParam)
    ? campaignIdParam
    : undefined;
  const mediaBuyerIdParam = url.searchParams.get('mediaBuyerId')?.trim();
  const mediaBuyerIdFilter =
    !isMediaBuyer && mediaBuyerIdParam && /^[0-9a-f-]{32,36}$/i.test(mediaBuyerIdParam)
      ? mediaBuyerIdParam
      : undefined;

  const adSpendScope = {
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(statusFilter && { status: statusFilter }),
    ...(searchFilter && { search: searchFilter }),
    ...(productIdFilter && { productId: productIdFilter }),
    ...(campaignIdFilter && { campaignId: campaignIdFilter }),
    ...(mediaBuyerIdFilter && { mediaBuyerId: mediaBuyerIdFilter }),
  };
  const adSpendInput = JSON.stringify({
    page,
    limit: AD_SPEND_PER_PAGE,
    ...adSpendScope,
  });
  // Phase 17 — accordion grouped view runs alongside the legacy flat list so
  // both renderings can co-exist while the UI migrates. Group page lives on
  // `?gpage=` to avoid colliding with the flat list's `?page=`.
  const groupsPage = Math.max(1, parseInt(url.searchParams.get('gpage') || '1', 10));
  const groupedScope: Record<string, unknown> = {
    page: groupsPage,
    limit: 20,
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(statusFilter && { status: statusFilter }),
    ...(searchFilter && { search: searchFilter }),
    ...(productIdFilter && { productId: productIdFilter }),
    ...(campaignIdFilter && { campaignId: campaignIdFilter }),
    ...(mediaBuyerIdFilter && { mediaBuyerId: mediaBuyerIdFilter }),
  };
  const groupedInput = JSON.stringify(groupedScope);
  // Picklists bundle input — the bundle procedure self-scopes Media Buyers and
  // refuses the buyer picklist for non-`users.read` callers, so we forward the
  // same filter context the legacy 3 individual calls shared (status counts +
  // listCampaigns + users.list[MEDIA_BUYER]).
  const picklistsBundleInput = encodeURIComponent(
    JSON.stringify({
      ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(searchFilter && { search: searchFilter }),
      ...(productIdFilter && { productId: productIdFilter }),
      ...(campaignIdFilter && { campaignId: campaignIdFilter }),
      ...(mediaBuyerIdFilter && { mediaBuyerId: mediaBuyerIdFilter }),
      campaignsLimit: 20,
    }),
  );

  const adSpendShell = {
    filters,
    viewMode: isMediaBuyer ? ('media_buyer' as const) : ('admin' as const),
    canApproveAdSpend,
  };

  const pageData = (async (): Promise<MarketingAdSpendLoaderData> => {
  const adSpendRes = await apiRequest<unknown>(
    `/trpc/marketing.listAdSpend?input=${encodeURIComponent(adSpendInput)}`,
    { method: 'GET', cookie },
  );

  const adSpendData = parseAdSpend(adSpendRes);
  const totalRows = adSpendData?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / AD_SPEND_PER_PAGE));

  const adSpendPicklists = (async (): Promise<{
    statusCounts: AdSpendStatusCounts;
    campaigns: Campaign[];
    mediaBuyersForFilter: Array<{ id: string; name: string }>;
  }> => {
    try {
      // One request collapses the previous 3 (statusCounts + listCampaigns +
      // users.list[MEDIA_BUYER]) — same fan-out runs server-side in parallel.
      const bundleRes = await apiRequest<unknown>(
        `/trpc/marketing.adSpendPagePicklistsBundle?input=${picklistsBundleInput}`,
        { method: 'GET', cookie },
      );
      if (!bundleRes.ok) {
        return {
          statusCounts: { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
          campaigns: [],
          mediaBuyersForFilter: [],
        };
      }
      const data = (
        bundleRes.data as {
          result?: {
            data?: {
              adSpendStatusCounts: AdSpendStatusCounts;
              campaigns: Campaign[];
              mediaBuyersForFilter: Array<{ id: string; name: string }>;
            };
          };
        }
      )?.result?.data;
      return {
        statusCounts: data?.adSpendStatusCounts ?? { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
        campaigns: data?.campaigns ?? [],
        mediaBuyersForFilter: data?.mediaBuyersForFilter ?? [],
      };
    } catch {
      return {
        statusCounts: { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
        campaigns: [],
        mediaBuyersForFilter: [],
      };
    }
  })();

  const data: MarketingAdSpendLoaderData = {
    viewMode: isMediaBuyer ? 'media_buyer' : 'admin',
    canApproveAdSpend,
    currentUserId: user.id,
    adSpend: adSpendData?.records ?? [],
    totalAdSpend: totalRows,
    adSpendTotal: adSpendData?.totalSpend ?? '0',
    page,
    limit: AD_SPEND_PER_PAGE,
    totalPages,
    statusFilter,
    searchFilter,
    productIdFilter,
    campaignIdFilter,
    mediaBuyerIdFilter,
    metrics: null,
    users: null,
    products: null,
    leaderboardPeriod,
    filters,
    groups: null,
    groupsTotal: 0,
    groupsPage: groupsPage,
    groupsTotalPages: 1,
    adSpendPicklists,
  };

  return data;
})();

  return defer({
    adSpendShell,
    pageData,
  } as unknown as Record<string, unknown>);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const result = await runMarketingAdSpendAction(cookie, formData);
  if (result) return result;
  return json({ error: 'Unknown action' }, { status: 400 });
}

const AD_SPEND_PICKLISTS_FALLBACK: Pick<
  MarketingAdSpendLoaderData,
  'statusCounts' | 'campaigns' | 'mediaBuyersForFilter'
> = {
  statusCounts: { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
  campaigns: [],
  mediaBuyersForFilter: [],
};

export default function AdminMarketingAdSpendRoute() {
  const { adSpendShell, pageData } = useLoaderData<typeof loader>() as unknown as {
    adSpendShell: {
      filters: MarketingAdSpendLoaderData['filters'];
      viewMode: MarketingAdSpendLoaderData['viewMode'];
      canApproveAdSpend: boolean;
    };
    pageData: Promise<MarketingAdSpendLoaderData>;
  };
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<MarketingAdSpendLoadingShell {...adSpendShell} />}
    
      loaderShell={{ adSpendShell }}
      deferredKey="pageData"
    >
      {(data) => {
        if (data.adSpendPicklists) {
          const { adSpendPicklists, ...rest } = data;
          const sync = rest as Omit<MarketingAdSpendLoaderData, 'adSpendPicklists'>;
          return (
            <Suspense
              fallback={
                <MarketingAdSpendPage {...sync} {...AD_SPEND_PICKLISTS_FALLBACK} picklistsLoading />
              }
            >
              <Await resolve={adSpendPicklists} errorElement={<DeferredError />}>
                {(pick) => <MarketingAdSpendPage {...sync} {...pick} />}
              </Await>
            </Suspense>
          );
        }
        return <MarketingAdSpendPage {...data} />;
      }}
    </CachedAwait>
  );
}
