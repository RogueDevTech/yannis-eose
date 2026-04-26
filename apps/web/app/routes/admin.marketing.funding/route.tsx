import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingFundingPage } from '~/features/marketing/MarketingFundingPage';
import type {
  FundingRequestStatusFilter,
  FundingSection,
  FundingTab,
  FundingSliceData,
  FundingRequestsSliceData,
  MarketingFundingLoaderData,
} from '~/features/marketing/types';
import {
  buildLeaderboardInput,
  getMarketingRoleFlags,
  parseFunding,
  parseFundingDirectionSummary,
  parseFundingRequestsPage,
  parseFundingRequestStatusCounts,
  parseFundingStatusCounts,
  parseLeaderboard,
  parseUsers,
  parseBalancesList,
  parseFundingBalance,
  resolveMarketingDateFilters,
  runMarketingFundingAction,
} from '~/lib/marketing-pages.server';

const PER_PAGE = 20;
const LEDGER_STATUSES = ['SENT', 'COMPLETED', 'DISPUTED'] as const;
const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const meta: MetaFunction = () => [{ title: 'Funding — Marketing — Yannis EOSE' }];

/**
 * Funding page loader — primary (`section`) + sub (`tab`) slices; same queries as before.
 *
 *   received + transfers | received + requests | distributing + transfers | distributing + requests
 *
 * URL: `?section=received|distributing`, `?tab=transfers|requests`, plus `page` / `status` /
 * `requestStatus` / `search` for the active slice only. Counts for all four slices every load;
 * records for the active slice only.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime, filters, leaderboardPeriod } = resolveMarketingDateFilters(url);
  const { isMediaBuyer, isFundingAdmin, canRequestFunding } = getMarketingRoleFlags(user.role);

  // HoM/Admin can disburse to MBs; Media Buyers cannot. Drives whether Section 2 renders.
  const canDistribute = !isMediaBuyer;

  // ── URL state with safe defaults ────────────────────────
  const sectionParam = url.searchParams.get('section');
  const activeSection: FundingSection =
    sectionParam === 'distributing' && canDistribute ? 'distributing' : 'received';

  const tabParam = url.searchParams.get('tab');
  const activeTab: FundingTab = tabParam === 'requests' ? 'requests' : 'transfers';

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));

  const statusParam = url.searchParams.get('status') ?? undefined;
  const statusFilter =
    statusParam && (LEDGER_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;

  const requestStatusParam = url.searchParams.get('requestStatus') ?? undefined;
  const requestStatusFilter: FundingRequestStatusFilter | undefined =
    requestStatusParam && (REQUEST_STATUSES as readonly string[]).includes(requestStatusParam)
      ? (requestStatusParam as FundingRequestStatusFilter)
      : undefined;

  const searchRaw = url.searchParams.get('search')?.trim();
  const searchFilter = searchRaw && searchRaw.length > 0 ? searchRaw : undefined;

  // ── Build per-slice query inputs ────────────────────────
  const dateRange = {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };

  // Per-slice count queries (all four run on every load)
  const incomingCountsInput = JSON.stringify({ receiverId: user.id, ...dateRange });
  const myRequestsCountsInput = JSON.stringify({ requesterId: user.id, ...dateRange });
  const outgoingCountsInput = JSON.stringify({ senderId: user.id, ...dateRange });
  const mbRequestsCountsInput = JSON.stringify({ excludeSelfAsRequester: true, ...dateRange });

  // Active slice's records (only the rows the user is currently viewing)
  let recordsUrl: string;
  let recordsKind: 'transfers' | 'requests';
  if (activeSection === 'received' && activeTab === 'transfers') {
    const input = JSON.stringify({
      page,
      limit: PER_PAGE,
      receiverId: user.id,
      ...dateRange,
      ...(statusFilter && { status: statusFilter }),
      ...(searchFilter && { search: searchFilter }),
    });
    recordsUrl = `/trpc/marketing.listFunding?input=${encodeURIComponent(input)}`;
    recordsKind = 'transfers';
  } else if (activeSection === 'received' && activeTab === 'requests') {
    const input = JSON.stringify({
      page,
      limit: PER_PAGE,
      requesterId: user.id,
      ...dateRange,
      ...(requestStatusFilter && { status: requestStatusFilter }),
      ...(searchFilter && { search: searchFilter }),
    });
    recordsUrl = `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(input)}`;
    recordsKind = 'requests';
  } else if (activeSection === 'distributing' && activeTab === 'transfers') {
    const input = JSON.stringify({
      page,
      limit: PER_PAGE,
      senderId: user.id,
      ...dateRange,
      ...(statusFilter && { status: statusFilter }),
      ...(searchFilter && { search: searchFilter }),
    });
    recordsUrl = `/trpc/marketing.listFunding?input=${encodeURIComponent(input)}`;
    recordsKind = 'transfers';
  } else {
    // distributing + requests → MB requests inbox
    const input = JSON.stringify({
      page,
      limit: PER_PAGE,
      excludeSelfAsRequester: true,
      ...dateRange,
      ...(requestStatusFilter && { status: requestStatusFilter }),
      ...(searchFilter && { search: searchFilter }),
    });
    recordsUrl = `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(input)}`;
    recordsKind = 'requests';
  }

  // ── Supporting fetches ──────────────────────────────────
  const directionSummaryInput = JSON.stringify(dateRange);
  const directionSummaryP = apiRequest<unknown>(
    `/trpc/marketing.fundingByDirectionSummary?input=${encodeURIComponent(directionSummaryInput)}`,
    { method: 'GET', cookie },
  );

  const leaderboardInput = buildLeaderboardInput(startDate, endDate, periodAllTime);
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  ).catch(() => ({ ok: false, data: { result: { data: [] } } }));

  const usersP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { users: [] } } } });

  const balancesListP: Promise<ReturnType<typeof parseBalancesList> | undefined> = isFundingAdmin
    ? apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie })
        .then(parseBalancesList)
        .catch(() => undefined)
    : Promise.resolve(undefined);

  const showFundingBalance = user.role === 'MEDIA_BUYER' || user.role === 'HEAD_OF_MARKETING';
  const fundingBalanceP = showFundingBalance
    ? apiRequest<unknown>(
        `/trpc/marketing.getFundingBalance?input=${encodeURIComponent(JSON.stringify({ userId: user.id }))}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });

  const incomingCountsP = apiRequest<unknown>(
    `/trpc/marketing.fundingStatusCounts?input=${encodeURIComponent(incomingCountsInput)}`,
    { method: 'GET', cookie },
  );
  const myRequestsCountsP = apiRequest<unknown>(
    `/trpc/marketing.fundingRequestStatusCounts?input=${encodeURIComponent(myRequestsCountsInput)}`,
    { method: 'GET', cookie },
  );
  const outgoingCountsP = canDistribute
    ? apiRequest<unknown>(
        `/trpc/marketing.fundingStatusCounts?input=${encodeURIComponent(outgoingCountsInput)}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });
  const mbRequestsCountsP = canDistribute
    ? apiRequest<unknown>(
        `/trpc/marketing.fundingRequestStatusCounts?input=${encodeURIComponent(mbRequestsCountsInput)}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });

  const recordsP = apiRequest<unknown>(recordsUrl, { method: 'GET', cookie });

  const [
    recordsRes,
    incomingCountsRes,
    myRequestsCountsRes,
    outgoingCountsRes,
    mbRequestsCountsRes,
    directionSummaryRes,
    leaderboardRes,
    usersRes,
    balancesList,
    fundingBalanceRes,
  ] = await Promise.all([
    recordsP,
    incomingCountsP,
    myRequestsCountsP,
    outgoingCountsP,
    mbRequestsCountsP,
    directionSummaryP,
    leaderboardP,
    usersP,
    balancesListP,
    fundingBalanceP,
  ]);

  // ── Parse counts ────────────────────────────────────────
  const incomingCounts = parseFundingStatusCounts(incomingCountsRes);
  const myRequestsCounts = parseFundingRequestStatusCounts(myRequestsCountsRes);
  const outgoingCounts = canDistribute
    ? parseFundingStatusCounts(outgoingCountsRes)
    : { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
  const mbRequestsCounts = canDistribute
    ? parseFundingRequestStatusCounts(mbRequestsCountsRes)
    : { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };

  // ── Empty slices (for inactive tabs — counts populated, records empty) ──
  const emptyTransfers = (counts: FundingSliceData['statusCounts']): FundingSliceData => ({
    records: [],
    total: 0,
    page: 1,
    totalPages: 1,
    statusCounts: counts,
  });
  const emptyRequests = (counts: FundingRequestsSliceData['statusCounts']): FundingRequestsSliceData => ({
    records: [],
    total: 0,
    page: 1,
    totalPages: 1,
    statusCounts: counts,
  });

  let receivedTransfers = emptyTransfers(incomingCounts);
  let myRequests = emptyRequests(myRequestsCounts);
  let outgoingTransfers: FundingSliceData | undefined = canDistribute ? emptyTransfers(outgoingCounts) : undefined;
  let mbRequests: FundingRequestsSliceData | undefined = canDistribute ? emptyRequests(mbRequestsCounts) : undefined;

  // ── Hydrate the active slice with the records we fetched ──
  if (recordsKind === 'transfers') {
    const fundingData = parseFunding(recordsRes);
    const total = fundingData?.pagination?.total ?? 0;
    const slice: FundingSliceData = {
      records: fundingData?.records ?? [],
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
      statusCounts: activeSection === 'received' ? incomingCounts : outgoingCounts,
      statusFilter,
      searchFilter,
    };
    if (activeSection === 'received') receivedTransfers = slice;
    else outgoingTransfers = slice;
  } else {
    const requestsData = parseFundingRequestsPage(recordsRes);
    const total = requestsData?.pagination?.total ?? 0;
    const slice: FundingRequestsSliceData = {
      records: requestsData?.records ?? [],
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
      statusCounts: activeSection === 'received' ? myRequestsCounts : mbRequestsCounts,
      statusFilter: requestStatusFilter,
      searchFilter,
    };
    if (activeSection === 'received') myRequests = slice;
    else mbRequests = slice;
  }

  const directionSummary = parseFundingDirectionSummary(directionSummaryRes);
  const fundingBalance = showFundingBalance ? parseFundingBalance(fundingBalanceRes) : undefined;
  const leaderboard = parseLeaderboard(leaderboardRes);
  const usersList = parseUsers(usersRes);

  const data: MarketingFundingLoaderData = {
    viewMode: isMediaBuyer ? 'media_buyer' : 'admin',
    currentUserId: user.id,
    currentUserRole: user.role,
    canSendFunding: isFundingAdmin,
    canRequestFunding,
    canDistribute,
    activeSection,
    activeTab,
    filters,
    receivedTransfers,
    myRequests,
    outgoingTransfers,
    mbRequests,
    directionSummary,
    fundingBalance,
    leaderboard,
    leaderboardPeriod,
    users: usersList,
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
