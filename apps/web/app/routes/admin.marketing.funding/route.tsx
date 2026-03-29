import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingFundingPage } from '~/features/marketing/MarketingFundingPage';
import type { FundingRequestStatusFilter, Metrics, MarketingFundingLoaderData } from '~/features/marketing/types';
import {
  buildLeaderboardInput,
  emptyMetrics,
  getMarketingRoleFlags,
  parseFunding,
  parseFundingRequestsPage,
  parseFundingRequestStatusCounts,
  parseFundingStatusCounts,
  parseFundingSummary,
  parseLeaderboard,
  parseMetrics,
  parseUsers,
  parseBalancesList,
  resolveMarketingDateFilters,
  runMarketingFundingAction,
} from '~/lib/marketing-pages.server';

const FUNDING_PER_PAGE = 20;
const FUNDING_LEDGER_STATUSES = ['SENT', 'COMPLETED', 'DISPUTED'] as const;
const FUNDING_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const meta: MetaFunction = () => [{ title: 'Funding — Marketing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const { isMediaBuyer, isFundingAdmin, canRequestFunding } = getMarketingRoleFlags(user.role);

  const showFundingRequestsFeed = isMediaBuyer || isFundingAdmin;
  const feedParam = url.searchParams.get('feed');
  const feed: MarketingFundingLoaderData['feed'] =
    feedParam === 'ledger'
      ? 'ledger'
      : feedParam === 'requests' && showFundingRequestsFeed
        ? 'requests'
        : showFundingRequestsFeed
          ? 'requests'
          : 'ledger';

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const searchRaw = url.searchParams.get('search')?.trim();
  const searchFilter = searchRaw && searchRaw.length > 0 ? searchRaw : undefined;
  const statusParam = url.searchParams.get('status') ?? undefined;
  const statusFilter =
    statusParam &&
    (FUNDING_LEDGER_STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : undefined;

  const requestStatusParam = url.searchParams.get('requestStatus') ?? undefined;
  const requestStatusFilter: FundingRequestStatusFilter | undefined =
    requestStatusParam &&
    (FUNDING_REQUEST_STATUSES as readonly string[]).includes(requestStatusParam)
      ? (requestStatusParam as FundingRequestStatusFilter)
      : undefined;

  const requestSearchRaw = url.searchParams.get('requestSearch')?.trim();
  const requestSearchFilter = requestSearchRaw && requestSearchRaw.length > 0 ? requestSearchRaw : undefined;

  const fundingScope = {
    ...(isMediaBuyer ? { receiverId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };
  const fundingInput = JSON.stringify({
    page,
    limit: FUNDING_PER_PAGE,
    ...fundingScope,
    ...(statusFilter && { status: statusFilter }),
    ...(searchFilter && { search: searchFilter }),
  });
  const countsInput = JSON.stringify({
    ...fundingScope,
    ...(searchFilter && { search: searchFilter }),
  });
  const requestCountsInput = JSON.stringify({
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });
  const requestCountsP = showFundingRequestsFeed
    ? apiRequest<unknown>(
        `/trpc/marketing.fundingRequestStatusCounts?input=${encodeURIComponent(requestCountsInput)}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });
  const metricsInput = JSON.stringify({
    ...(isMediaBuyer ? { mediaBuyerId: user.id } : {}),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  });

  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, { method: 'GET', cookie });

  const summaryP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { totalSent: '0', totalCompleted: '0', totalDisputed: '0' } } } });
  const usersP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { users: [] } } } });

  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  ).catch(() => ({ ok: false, data: { result: { data: [] } } }));

  const balancesListP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie })
        .then(parseBalancesList)
        .catch(() => [] as ReturnType<typeof parseBalancesList>)
    : undefined;

  let fundingData = null as ReturnType<typeof parseFunding>;
  let statusCounts = { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
  let fundingRequests: MarketingFundingLoaderData['fundingRequests'] = [];
  let totalFunding = 0;
  let totalFundingRequests = 0;
  let requestStatusCounts = parseFundingRequestStatusCounts({ ok: false, data: {} });

  if (feed === 'ledger') {
    const fundingP = apiRequest<unknown>(`/trpc/marketing.listFunding?input=${encodeURIComponent(fundingInput)}`, {
      method: 'GET',
      cookie,
    });
    const fundingCountsP = apiRequest<unknown>(
      `/trpc/marketing.fundingStatusCounts?input=${encodeURIComponent(countsInput)}`,
      { method: 'GET', cookie },
    );
    const [fundingRes, countsRes, reqCountsRes] = await Promise.all([fundingP, fundingCountsP, requestCountsP]);
    fundingData = parseFunding(fundingRes);
    statusCounts = parseFundingStatusCounts(countsRes);
    requestStatusCounts = parseFundingRequestStatusCounts(reqCountsRes);
    totalFunding = fundingData?.pagination?.total ?? 0;
  } else {
    const requestsListInput = JSON.stringify({
      page,
      limit: FUNDING_PER_PAGE,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(requestStatusFilter && { status: requestStatusFilter }),
      ...(requestSearchFilter && { search: requestSearchFilter }),
    });
    const requestsP = apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(requestsListInput)}`,
      { method: 'GET', cookie },
    );
    const [requestsRes, reqCountsRes] = await Promise.all([requestsP, requestCountsP]);
    const requestsData = parseFundingRequestsPage(requestsRes);
    fundingRequests = requestsData?.records ?? [];
    totalFundingRequests = requestsData?.pagination?.total ?? 0;
    requestStatusCounts = parseFundingRequestStatusCounts(reqCountsRes);
  }

  const totalPages = Math.max(1, Math.ceil(totalFunding / FUNDING_PER_PAGE));
  const totalPagesRequests = Math.max(1, Math.ceil(totalFundingRequests / FUNDING_PER_PAGE));

  const [metrics, fundingSummary, leaderboard, usersData, balancesList] = await Promise.all([
    metricsP.then(parseMetrics).catch((): Metrics => emptyMetrics()),
    summaryP.then(parseFundingSummary).catch(() => ({
      totalSent: '0',
      totalCompleted: '0',
      totalDisputed: '0',
    })),
    leaderboardP.then((r) => parseLeaderboard(r)).catch(() => []),
    usersP.then(parseUsers).catch(() => []),
    balancesListP ?? Promise.resolve(undefined),
  ]);

  const data: MarketingFundingLoaderData = {
    viewMode: isMediaBuyer ? 'media_buyer' : 'admin',
    currentUserId: user.id,
    canSendFunding: isFundingAdmin,
    canRequestFunding,
    funding: fundingData?.records ?? [],
    totalFunding,
    page,
    limit: FUNDING_PER_PAGE,
    totalPages,
    statusFilter,
    searchFilter,
    statusCounts,
    fundingRequests,
    feed,
    showFundingRequestsFeed,
    requestStatusFilter,
    requestSearchFilter,
    requestStatusCounts,
    totalFundingRequests,
    totalPagesRequests,
    metrics,
    fundingSummary,
    leaderboard,
    users: usersData,
    leaderboardPeriod,
    filters,
    balancesList,
  };

  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const result = await runMarketingFundingAction(cookie, formData);
  if (result) return result;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingFundingRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingFundingPage {...data} />;
}
