import { useEffect, useState } from 'react';
import { useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, parsePerPage, requirePermission } from '~/lib/api.server';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { useMultiDeferredCacheSync } from '~/hooks/useMultiDeferredCacheSync';
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

const AD_SPEND_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const meta: MetaFunction = () => [{ title: 'Marketing Expenses — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  // Default to "this month" — matches every other marketing page (Overview, Team,
  // Orders, Leaderboard, Funding). The previous `last_48_hours` default hid every
  // entry older than 2 days, so users landing on the page from the sidebar saw
  // ₦0 even when their period had real spend.
  // CEO directive 2026-05-10: ad-spend listing is a "today's spend" workflow
  // for HoM / team leads, so default the date filter to today (not this month).
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url, 'today');
  const { isMediaBuyer, isFundingAdmin, canApproveAdSpend } = getMarketingRoleFlags(user);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  // URL-driven page sizes — flat list keyed on `?perPage=`, the daily-grouped
  // accordion on `?gPerPage=` (its own pagination param is `gpage`).
  const { perPage: AD_SPEND_PER_PAGE } = parsePerPage(url.searchParams);
  const { perPage: GROUPS_PER_PAGE } = parsePerPage(url.searchParams, { param: 'gPerPage' });
  const searchRaw = url.searchParams.get('search')?.trim();
  const searchFilter = searchRaw && searchRaw.length > 0 ? searchRaw : undefined;
  const statusParam = url.searchParams.get('status') ?? undefined;
  const statusFilter: AdSpendStatusFilter | undefined =
    statusParam && (AD_SPEND_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as AdSpendStatusFilter)
      : undefined;
  const EXPENSE_CATEGORIES = ['AD_SPEND', 'AD_ACCOUNT', 'RECRUITMENT_AD', 'WHATSAPP_CAMPAIGN', 'UGC_PRODUCTION', 'OTHER'] as const;
  const categoryParam = url.searchParams.get('category') ?? undefined;
  // NOT_AD_SPEND is a virtual category: shows all expenses except AD_SPEND.
  const isNotAdSpend = categoryParam === 'NOT_AD_SPEND';
  const categoryFilter = isNotAdSpend
    ? 'NOT_AD_SPEND'
    : categoryParam && (EXPENSE_CATEGORIES as readonly string[]).includes(categoryParam)
      ? categoryParam
      : 'AD_SPEND';
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
  const SORT_KEYS = ['spendDate', 'spendAmount', 'status', 'createdAt'] as const;
  const sortByParam = url.searchParams.get('sortBy') ?? undefined;
  const sortBy = sortByParam && (SORT_KEYS as readonly string[]).includes(sortByParam)
    ? (sortByParam as (typeof SORT_KEYS)[number])
    : undefined;
  const sortDirParam = url.searchParams.get('sortDir') ?? undefined;
  const sortDir = sortDirParam === 'asc' || sortDirParam === 'desc' ? sortDirParam : undefined;

  const categoryScope = isNotAdSpend
    ? { excludeCategory: 'AD_SPEND' as const }
    : categoryFilter && categoryFilter !== 'NOT_AD_SPEND' ? { category: categoryFilter } : {};
  const adSpendScope = {
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(statusFilter && { status: statusFilter }),
    ...categoryScope,
    ...(searchFilter && { search: searchFilter }),
    ...(productIdFilter && { productId: productIdFilter }),
    ...(campaignIdFilter && { campaignId: campaignIdFilter }),
    ...(mediaBuyerIdFilter && { mediaBuyerId: mediaBuyerIdFilter }),
  };
  const adSpendInput = JSON.stringify({
    page,
    limit: AD_SPEND_PER_PAGE,
    ...adSpendScope,
    ...(sortBy && { sortBy }),
    ...(sortDir && { sortDir }),
  });
  // Phase 17 — accordion grouped view runs alongside the legacy flat list so
  // both renderings can co-exist while the UI migrates. Group page lives on
  // `?gpage=` to avoid colliding with the flat list's `?page=`.
  const groupsPage = Math.max(1, parseInt(url.searchParams.get('gpage') || '1', 10));
  const groupedScope: Record<string, unknown> = {
    page: groupsPage,
    limit: GROUPS_PER_PAGE,
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(statusFilter && { status: statusFilter }),
    ...categoryScope,
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
      ...categoryScope,
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

  // Single deferred block — both listAdSpend + picklistsBundle run in parallel
  // within one Promise, cutting from 2 serial HTTP round-trips to 1 wall-clock wait.
  const picklistsPromise = (async (): Promise<AdSpendPicklists> => {
    return AD_SPEND_PICKLISTS_FALLBACK;
  })();

  const pageData = (async (): Promise<MarketingAdSpendLoaderData> => {
  const [adSpendRes, picklistsBundleRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.listAdSpend?input=${encodeURIComponent(adSpendInput)}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/marketing.adSpendPagePicklistsBundle?input=${picklistsBundleInput}`,
      { method: 'GET', cookie },
    ),
  ]);

  // Parse picklists from bundle
  const picklistsData = picklistsBundleRes.ok
    ? ((picklistsBundleRes.data as { result?: { data?: { adSpendStatusCounts: AdSpendStatusCounts; campaigns: Campaign[]; mediaBuyersForFilter: Array<{ id: string; name: string }>; marketingTeams?: Array<{ id: string; name: string; memberIds: string[] }> } } })?.result?.data ?? null)
    : null;

  const adSpendData = parseAdSpend(adSpendRes);
  const totalRows = adSpendData?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / AD_SPEND_PER_PAGE));

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
    categoryFilter,
    searchFilter,
    productIdFilter,
    campaignIdFilter,
    mediaBuyerIdFilter,
    sortBy,
    sortDir,
    metrics: null,
    users: null,
    products: null,
    leaderboardPeriod,
    filters,
    groups: null,
    groupsTotal: 0,
    groupsPage: groupsPage,
    groupsTotalPages: 1,
    groupsPerPage: GROUPS_PER_PAGE,
    // Picklists merged from the parallel bundle call
    statusCounts: picklistsData?.adSpendStatusCounts ?? undefined,
    campaigns: picklistsData?.campaigns ?? undefined,
    mediaBuyersForFilter: picklistsData?.mediaBuyersForFilter ?? undefined,
    marketingTeams: picklistsData?.marketingTeams ?? undefined,
  };

  return data;
})();

  return defer({
    adSpendShell,
    pageData,
    picklistsPromise,
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

const AD_SPEND_PICKLISTS_FALLBACK: AdSpendPicklists = {
  statusCounts: { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 },
  campaigns: [],
  mediaBuyersForFilter: [],
  marketingTeams: [],
};

type AdSpendPicklists = Pick<
  MarketingAdSpendLoaderData,
  'statusCounts' | 'campaigns' | 'mediaBuyersForFilter' | 'marketingTeams'
>;

function isResolvedPicklists(v: AdSpendPicklists | Promise<AdSpendPicklists>): v is AdSpendPicklists {
  return typeof v === 'object' && v != null && !('then' in (v as object));
}

/**
 * Bridges the picklists promise into local state instead of resolving it via
 * a Suspense boundary. The previous Suspense+Await pattern rendered
 * `<MarketingAdSpendPage>` in two distinct React positions (fallback +
 * Await children); when the picklists resolved, React unmounted the fallback
 * subtree and mounted the children subtree, resetting the page's local state
 * (filter modals, scroll position, accordion open/closed) and re-firing
 * internal skeletons — the second flicker.
 *
 * Returning `<MarketingAdSpendPage>` at the same tree position on both
 * branches lets React reconcile in place: same component type → keep mounted
 * → just update props. No remount, no flicker.
 */
function AdSpendWithPicklists({
  sync,
  picklistsPromise,
}: {
  sync: MarketingAdSpendLoaderData;
  picklistsPromise: Promise<AdSpendPicklists> | AdSpendPicklists;
}) {
  const [picklists, setPicklists] = useState<AdSpendPicklists | null>(
    isResolvedPicklists(picklistsPromise) ? picklistsPromise : null,
  );
  useEffect(() => {
    if (isResolvedPicklists(picklistsPromise)) {
      setPicklists(picklistsPromise);
      return;
    }
    let cancelled = false;
    Promise.resolve(picklistsPromise)
      .then((p) => {
        if (!cancelled) setPicklists(p);
      })
      .catch(() => {
        if (!cancelled) setPicklists(AD_SPEND_PICKLISTS_FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, [picklistsPromise]);

  if (picklists === null) {
    return <MarketingAdSpendPage {...sync} {...AD_SPEND_PICKLISTS_FALLBACK} picklistsLoading />;
  }
  return <MarketingAdSpendPage {...sync} {...picklists} />;
}

export default function AdminMarketingAdSpendRoute() {
  const { adSpendShell, pageData, picklistsPromise } = useLoaderData<typeof loader>() as unknown as {
    adSpendShell: {
      filters: MarketingAdSpendLoaderData['filters'];
      viewMode: MarketingAdSpendLoaderData['viewMode'];
      canApproveAdSpend: boolean;
    };
    pageData: Promise<MarketingAdSpendLoaderData>;
    picklistsPromise: Promise<AdSpendPicklists> | AdSpendPicklists;
  };
  useMultiDeferredCacheSync({
    shell: { adSpendShell },
    deferred: { pageData, picklistsPromise },
  });
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<MarketingAdSpendLoadingShell {...adSpendShell} />}
    >
      {(data) => {
        return <AdSpendWithPicklists sync={data} picklistsPromise={picklistsPromise} />;
      }}
    </CachedAwait>
  );
}
