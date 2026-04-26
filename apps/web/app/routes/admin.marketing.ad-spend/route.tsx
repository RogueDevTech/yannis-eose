import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingAdSpendPage } from '~/features/marketing/MarketingAdSpendPage';
import type { AdSpendStatusFilter, MarketingAdSpendLoaderData } from '~/features/marketing/types';
import {
  buildLeaderboardInput,
  emptyMetrics,
  getMarketingRoleFlags,
  parseAdSpend,
  parseAdSpendStatusCounts,
  parseCampaigns,
  parseLeaderboard,
  parseMetrics,
  parseProducts,
  parseUsers,
  resolveMarketingDateFilters,
  runMarketingAdSpendAction,
} from '~/lib/marketing-pages.server';

const AD_SPEND_PER_PAGE = 20;
const AD_SPEND_STATUSES = ['PENDING', 'APPROVED'] as const;

export const meta: MetaFunction = () => [{ title: 'Ad spend — Marketing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const { isMediaBuyer, isFundingAdmin } = getMarketingRoleFlags(user.role);

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

  const adSpendScope = {
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(statusFilter && { status: statusFilter }),
    ...(searchFilter && { search: searchFilter }),
    ...(productIdFilter && { productId: productIdFilter }),
  };
  const adSpendInput = JSON.stringify({
    page,
    limit: AD_SPEND_PER_PAGE,
    ...adSpendScope,
  });
  // Status counts share the product filter so the pill counts match the visible list.
  const countsInput = JSON.stringify({
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(searchFilter && { search: searchFilter }),
    ...(productIdFilter && { productId: productIdFilter }),
  });
  const metricsInput = JSON.stringify({
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });
  const campaignsInput = JSON.stringify(isMediaBuyer ? { mediaBuyerId: user.id, page: 1, limit: 20 } : { page: 1, limit: 20 });

  const adSpendP = apiRequest<unknown>(`/trpc/marketing.listAdSpend?input=${encodeURIComponent(adSpendInput)}`, { method: 'GET', cookie });
  const adSpendCountsP = apiRequest<unknown>(
    `/trpc/marketing.adSpendStatusCounts?input=${encodeURIComponent(countsInput)}`,
    { method: 'GET', cookie },
  );
  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, { method: 'GET', cookie });
  const campaignsP = apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${encodeURIComponent(campaignsInput)}`, { method: 'GET', cookie });
  const productsP = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });

  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  ).catch(() => ({ ok: false, data: { result: { data: [] } } }));

  const [adSpendRes, adSpendCountsRes, campaignsRes] = await Promise.all([adSpendP, adSpendCountsP, campaignsP]);
  const adSpendData = parseAdSpend(adSpendRes);
  const statusCounts = parseAdSpendStatusCounts(adSpendCountsRes);
  const totalRows = adSpendData?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / AD_SPEND_PER_PAGE));

  // Resolve names for every user ID actually referenced on this page (buyers + approvers),
  // ignoring pagination and status filters so we still show names for deactivated users.
  // Much cheaper than fetching the whole user list, and correct at any org size.
  const userIdsOnPage = new Set<string>();
  for (const row of adSpendData?.records ?? []) {
    if (row.mediaBuyerId) userIdsOnPage.add(row.mediaBuyerId);
    if (row.approvedBy) userIdsOnPage.add(row.approvedBy);
  }
  const usersP = isFundingAdmin && userIdsOnPage.size > 0
    ? apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ userIds: Array.from(userIdsOnPage), limit: 100 }))}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: true, data: { result: { data: { users: [] } } } });

  const [metrics, leaderboard, usersData, productsDataRaw] = await Promise.all([
    metricsP.then(parseMetrics).catch(() => emptyMetrics()),
    leaderboardP.then((r) => parseLeaderboard(r)).catch(() => []),
    usersP.then(parseUsers).catch(() => []),
    productsP.then(parseProducts).catch(() => []),
  ]);

  // Media buyers only see products that are assigned to them — i.e. referenced by any of
  // their own campaigns' `productIds`. Admins / HoM still see the full product catalog.
  // The campaign list was already filtered by `mediaBuyerId = user.id` at fetch time, so
  // collecting `productIds` from those campaigns yields the right scoping for free.
  let productsData = productsDataRaw;
  if (isMediaBuyer) {
    const allowedProductIds = new Set<string>();
    const campaignsRaw = (campaignsRes.ok
      ? (campaignsRes.data as { result?: { data?: { campaigns?: Array<{ productIds?: string[] | null }> } } })?.result?.data?.campaigns
      : []) ?? [];
    for (const c of campaignsRaw) {
      if (Array.isArray(c.productIds)) {
        for (const id of c.productIds) {
          if (id) allowedProductIds.add(id);
        }
      }
    }
    productsData = productsDataRaw.filter((p) => allowedProductIds.has(p.id));
  }

  const data: MarketingAdSpendLoaderData = {
    viewMode: isMediaBuyer ? 'media_buyer' : 'admin',
    adSpend: adSpendData?.records ?? [],
    totalAdSpend: totalRows,
    adSpendTotal: adSpendData?.totalSpend ?? '0',
    page,
    limit: AD_SPEND_PER_PAGE,
    totalPages,
    statusFilter,
    searchFilter,
    productIdFilter,
    statusCounts,
    campaigns: parseCampaigns(campaignsRes),
    metrics,
    leaderboard,
    users: usersData,
    products: productsData,
    leaderboardPeriod,
    filters,
  };

  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const result = await runMarketingAdSpendAction(cookie, formData);
  if (result) return result;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminMarketingAdSpendRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingAdSpendPage {...data} />;
}
