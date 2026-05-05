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
  getMarketingRoleFlags,
  parseFunding,
  parseFundingDirectionSummary,
  parseFundingRequestsPage,
  parseFundingRequestStatusCounts,
  parseFundingStatusCounts,
  parseUsers,
  parseBalancesList,
  parseFundingBalance,
  toDistributingFundingEntries,
  resolveMarketingDateFilters,
  runMarketingFundingAction,
} from '~/lib/marketing-pages.server';

const PER_PAGE = 20;
/** Upper bound of `listFunding` / `listFundingRequests` (`limit` zod-capped at 100).
 * Used when the unified table fetches transfers + requests in one shot for an
 * `entryType=all` view — we over-fetch a single page and merge client-side.
 * Anything above 100 is silently rejected by the API validator. */
const MERGED_FETCH_LIMIT = 100;
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
  const { startDate, endDate, periodAllTime, filters } = resolveMarketingDateFilters(url);
  const { isMediaBuyer, isFundingAdmin, canRequestFunding } = getMarketingRoleFlags(user.role);

  // HoM/Admin can disburse to MBs; Media Buyers cannot. Drives whether Section 2 renders.
  const canDistribute = !isMediaBuyer;

  // ── URL state with safe defaults ────────────────────────
  // Default section is `distributing` for users who can distribute (HoM/Admin)
  // — that's their primary working surface. MBs (no canDistribute) default to
  // `received`. Explicit `?section=received` always wins.
  const sectionParam = url.searchParams.get('section');
  const activeSection: FundingSection =
    sectionParam === 'received'
      ? 'received'
      : canDistribute
        ? 'distributing'
        : 'received';

  const tabParam = url.searchParams.get('tab');
  const activeTab: FundingTab = tabParam === 'requests' ? 'requests' : 'transfers';
  const entryTypeParam = url.searchParams.get('entryType');
  const entryTypeFilter: 'all' | 'transfer' | 'request' =
    entryTypeParam === 'transfer' || entryTypeParam === 'request' ? entryTypeParam : 'all';

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));

  const statusParam = url.searchParams.get('status') ?? undefined;
  const statusFilter =
    statusParam && (LEDGER_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;

  const requestStatusParam = url.searchParams.get('requestStatus') ?? undefined;
  const requestStatusFilter: FundingRequestStatusFilter | undefined =
    requestStatusParam && (REQUEST_STATUSES as readonly string[]).includes(requestStatusParam)
      ? (requestStatusParam as FundingRequestStatusFilter)
      : undefined;
  const entryStatusParam = url.searchParams.get('entryStatus') ?? undefined;
  const transferStatusFilter =
    entryStatusParam && (LEDGER_STATUSES as readonly string[]).includes(entryStatusParam)
      ? entryStatusParam
      : undefined;
  const requestStatusFilterUnified =
    entryStatusParam && (REQUEST_STATUSES as readonly string[]).includes(entryStatusParam)
      ? (entryStatusParam as FundingRequestStatusFilter)
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

  // When the unified status filter is exclusive to one entry type — e.g.
  // PENDING / APPROVED / REJECTED only apply to requests; SENT / COMPLETED /
  // DISPUTED only apply to transfers — skip fetching the other type entirely.
  // Without this, `entryStatus=PENDING` would still fetch ALL outgoing transfers
  // (no transfer-status filter applied) and they push the matching request
  // off page 1. Hoisted out of the `distributing` branch so the records-
  // hydration block below can also use it for pagination math.
  const isRequestOnlyStatus =
    !!entryStatusParam && (REQUEST_STATUSES as readonly string[]).includes(entryStatusParam);
  const isTransferOnlyStatus =
    !!entryStatusParam && (LEDGER_STATUSES as readonly string[]).includes(entryStatusParam);
  const skipTransfersForStatus = entryTypeFilter !== 'transfer' && isRequestOnlyStatus;
  const skipRequestsForStatus = entryTypeFilter !== 'request' && isTransferOnlyStatus;

  // Both sections render unified tables (transfers + requests merged); both
  // sides need their record URLs built when the section is active. Legacy
  // `recordsUrl` is kept as a single-call fallback that the hydration block
  // ignores — both unified branches use the dual-URL pattern below.
  let receivedTransfersUrl: string | null = null;
  let receivedRequestsUrl: string | null = null;
  let distributingTransfersUrl: string | null = null;
  let distributingRequestsUrl: string | null = null;

  if (activeSection === 'received') {
    // Section 1 — "Funds I've Received" unified table. Fetch both incoming
    // transfers AND my outbound requests so the merged feed has both rows.
    // `entryTypeFilter` and `entryStatus` filters narrow the fetch the same
    // way they do for distributing — request-only status skips the transfer
    // call, transfer-only status skips the request call.
    const transferInput =
      entryTypeFilter === 'request' || skipTransfersForStatus
        ? null
        : JSON.stringify({
            page: entryTypeFilter === 'transfer' ? page : 1,
            limit: entryTypeFilter === 'transfer' ? PER_PAGE : MERGED_FETCH_LIMIT,
            receiverId: user.id,
            ...dateRange,
            ...(transferStatusFilter ? { status: transferStatusFilter } : {}),
            ...(searchFilter && { search: searchFilter }),
          });
    const requestInput =
      entryTypeFilter === 'transfer' || skipRequestsForStatus
        ? null
        : JSON.stringify({
            page: entryTypeFilter === 'request' ? page : 1,
            limit: entryTypeFilter === 'request' ? PER_PAGE : MERGED_FETCH_LIMIT,
            requesterId: user.id,
            ...dateRange,
            ...(requestStatusFilterUnified ? { status: requestStatusFilterUnified } : {}),
            ...(searchFilter && { search: searchFilter }),
          });
    receivedTransfersUrl = transferInput
      ? `/trpc/marketing.listFunding?input=${encodeURIComponent(transferInput)}`
      : null;
    receivedRequestsUrl = requestInput
      ? `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(requestInput)}`
      : null;
  } else if (activeSection === 'distributing') {
    // Distributing section renders one unified table (UnifiedDistributingTable) for
    // BOTH tabs — `tab=transfers` and `tab=requests` are visual/state hints, not
    // separate datasets. Both transfers and request URLs must be populated so the
    // merged-entries builder below can paginate them together.
    // `entryTypeFilter` (?entryType=transfer|request) is the actual filter knob.
    // `skipTransfersForStatus` / `skipRequestsForStatus` are computed above so
    // a request-only status (e.g. PENDING) doesn't pull all transfers.
    const transferInput =
      entryTypeFilter === 'request' || skipTransfersForStatus
        ? null
        : JSON.stringify({
            page: entryTypeFilter === 'transfer' ? page : 1,
            limit: entryTypeFilter === 'transfer' ? PER_PAGE : MERGED_FETCH_LIMIT,
            senderId: user.id,
            ...dateRange,
            ...(transferStatusFilter ? { status: transferStatusFilter } : {}),
            ...(searchFilter && { search: searchFilter }),
          });
    const requestInput =
      entryTypeFilter === 'transfer' || skipRequestsForStatus
        ? null
        : JSON.stringify({
            page: entryTypeFilter === 'request' ? page : 1,
            limit: entryTypeFilter === 'request' ? PER_PAGE : MERGED_FETCH_LIMIT,
            excludeSelfAsRequester: true,
            ...dateRange,
            ...(requestStatusFilterUnified ? { status: requestStatusFilterUnified } : {}),
            ...(searchFilter && { search: searchFilter }),
          });
    distributingTransfersUrl = transferInput
      ? `/trpc/marketing.listFunding?input=${encodeURIComponent(transferInput)}`
      : null;
    distributingRequestsUrl = requestInput
      ? `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(requestInput)}`
      : null;
  }

  // ── Supporting fetches ──────────────────────────────────
  const directionSummaryInput = JSON.stringify(dateRange);
  const directionSummaryP = apiRequest<unknown>(
    `/trpc/marketing.fundingByDirectionSummary?input=${encodeURIComponent(directionSummaryInput)}`,
    { method: 'GET', cookie },
  );

  const usersP = isFundingAdmin
    ? apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: { users: [] } } } });

  // Resolve active branch name for the "Showing Media Buyers in <branch>" hint in the
  // Send Funding modal. `branches.list` is cheap (one row per branch the caller belongs to,
  // or all branches for SuperAdmin/Admin) and is already a hot endpoint elsewhere.
  const branchesP = user.currentBranchId
    ? apiRequest<{ result?: { data?: Array<{ id: string; name: string }> } }>(
        '/trpc/branches.list',
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });

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

  // Recipient candidates for the Request Funding modal (migration 0106). Only
  // fetched when the caller can request funding so we don't pay the cost
  // for read-only viewers (Finance/Admin etc.).
  const fundingRequestRecipientsP = canRequestFunding
    ? apiRequest<unknown>('/trpc/marketing.listFundingRequestRecipients', { method: 'GET', cookie })
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

  const receivedTransfersP =
    activeSection === 'received' && receivedTransfersUrl
      ? apiRequest<unknown>(receivedTransfersUrl, { method: 'GET', cookie })
      : Promise.resolve({ ok: true as const, data: {} });
  const receivedRequestsP =
    activeSection === 'received' && receivedRequestsUrl
      ? apiRequest<unknown>(receivedRequestsUrl, { method: 'GET', cookie })
      : Promise.resolve({ ok: true as const, data: {} });
  const distributingTransfersP =
    activeSection === 'distributing' && distributingTransfersUrl
      ? apiRequest<unknown>(distributingTransfersUrl, { method: 'GET', cookie })
      : Promise.resolve({ ok: true as const, data: {} });
  const distributingRequestsP =
    activeSection === 'distributing' && distributingRequestsUrl
      ? apiRequest<unknown>(distributingRequestsUrl, { method: 'GET', cookie })
      : Promise.resolve({ ok: true as const, data: {} });

  const [
    receivedTransfersRes,
    receivedRequestsRes,
    incomingCountsRes,
    myRequestsCountsRes,
    outgoingCountsRes,
    mbRequestsCountsRes,
    directionSummaryRes,
    usersRes,
    balancesList,
    fundingBalanceRes,
    distributingTransfersRes,
    distributingRequestsRes,
    branchesRes,
    fundingRequestRecipientsRes,
  ] = await Promise.all([
    receivedTransfersP,
    receivedRequestsP,
    incomingCountsP,
    myRequestsCountsP,
    outgoingCountsP,
    mbRequestsCountsP,
    directionSummaryP,
    usersP,
    balancesListP,
    fundingBalanceP,
    distributingTransfersP,
    distributingRequestsP,
    branchesP,
    fundingRequestRecipientsP,
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
  let distributingEntries:
    | MarketingFundingLoaderData['distributingEntries']
    | undefined = undefined;

  // ── Hydrate the active slice with the records we fetched ──
  if (activeSection === 'received') {
    // Section 1 unified table: hydrate BOTH receivedTransfers and myRequests
    // record arrays. Counts come from the standalone `fundingStatusCounts` /
    // `fundingRequestStatusCounts` queries — they're authoritative across the
    // full period regardless of entryType/entryStatus filters. The merge +
    // filter logic on the frontend handles the rest.
    const transferData = parseFunding(receivedTransfersRes);
    const requestData = parseFundingRequestsPage(receivedRequestsRes);
    const transferRecords = transferData?.records ?? [];
    const requestRecords = requestData?.records ?? [];

    receivedTransfers = {
      records: transferRecords,
      total: transferData?.pagination?.total ?? incomingCounts.ALL,
      page,
      totalPages: Math.max(1, Math.ceil((transferData?.pagination?.total ?? incomingCounts.ALL) / PER_PAGE)),
      statusCounts: incomingCounts,
      statusFilter,
      searchFilter,
    };
    myRequests = {
      records: requestRecords,
      total: requestData?.pagination?.total ?? myRequestsCounts.ALL,
      page,
      totalPages: Math.max(1, Math.ceil((requestData?.pagination?.total ?? myRequestsCounts.ALL) / PER_PAGE)),
      statusCounts: myRequestsCounts,
      statusFilter: requestStatusFilter,
      searchFilter,
    };
  } else if (activeSection === 'distributing') {
    const transferData = parseFunding(distributingTransfersRes);
    const requestData = parseFundingRequestsPage(distributingRequestsRes);
    const transferRows = transferData?.records ?? [];
    const requestRows = requestData?.records ?? [];
    const merged = toDistributingFundingEntries(transferRows, requestRows);
    const startIndex = (page - 1) * PER_PAGE;
    const paged = entryTypeFilter === 'all' ? merged.slice(startIndex, startIndex + PER_PAGE) : merged;
    // Pagination total accounts for the entry-type filter AND the entry-status
    // filter — when status is request-only (PENDING/APPROVED/REJECTED) the
    // transfer side of the merged list is empty, so total is just the matching
    // request count; same logic in reverse for transfer-only statuses.
    const transferStatusCount = transferStatusFilter
      ? (outgoingCounts[transferStatusFilter as keyof typeof outgoingCounts] ?? 0)
      : outgoingCounts.ALL;
    const requestStatusCount = requestStatusFilterUnified
      ? (mbRequestsCounts[requestStatusFilterUnified as keyof typeof mbRequestsCounts] ?? 0)
      : mbRequestsCounts.ALL;
    const totalMergedCount =
      entryTypeFilter === 'transfer'
        ? transferStatusCount
        : entryTypeFilter === 'request'
          ? requestStatusCount
          : skipTransfersForStatus
            ? requestStatusCount
            : skipRequestsForStatus
              ? transferStatusCount
              : transferStatusCount + requestStatusCount;

    distributingEntries = {
      records: paged,
      total: totalMergedCount,
      page,
      totalPages: Math.max(1, Math.ceil(totalMergedCount / PER_PAGE)),
      typeFilter: entryTypeFilter,
      statusFilter: entryStatusParam ?? statusParam ?? requestStatusParam ?? undefined,
      searchFilter,
      typeCounts: {
        all: outgoingCounts.ALL + mbRequestsCounts.ALL,
        transfer: outgoingCounts.ALL,
        request: mbRequestsCounts.ALL,
      },
      statusCounts: {
        SENT: outgoingCounts.SENT,
        COMPLETED: outgoingCounts.COMPLETED,
        DISPUTED: outgoingCounts.DISPUTED,
        PENDING: mbRequestsCounts.PENDING,
        APPROVED: mbRequestsCounts.APPROVED,
        REJECTED: mbRequestsCounts.REJECTED,
        ALL: outgoingCounts.ALL + mbRequestsCounts.ALL,
      },
    };
  }

  const directionSummary = parseFundingDirectionSummary(directionSummaryRes);
  const fundingBalance = showFundingBalance ? parseFundingBalance(fundingBalanceRes) : undefined;
  const usersList = parseUsers(usersRes);

  // Funding request recipient candidates (migration 0106 — empty array when the
  // current user can't request funding, since the list isn't fetched in that
  // case).
  const fundingRequestRecipients: Array<{
    id: string;
    name: string;
    role: string;
    isFinance: boolean;
    isPreferred: boolean;
    branchId: string | null;
  }> = canRequestFunding && fundingRequestRecipientsRes.ok
    ? ((fundingRequestRecipientsRes.data as {
        result?: {
          data?: Array<{
            id: string;
            name: string;
            role: string;
            isFinance: boolean;
            isPreferred: boolean;
            branchId: string | null;
          }>;
        };
      }).result?.data ?? [])
    : [];

  // Resolve active branch name from the branches.list payload — null if the user has
  // no active branch (admin in global view) or the branch can't be found in the response.
  let activeBranchName: string | null = null;
  if (user.currentBranchId && branchesRes.ok) {
    const branchesData = (branchesRes.data as { result?: { data?: Array<{ id: string; name: string }> } })
      .result?.data;
    if (Array.isArray(branchesData)) {
      const match = branchesData.find((b) => b.id === user.currentBranchId);
      activeBranchName = match?.name ?? null;
    }
  }

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
    distributingEntries,
    directionSummary,
    fundingBalance,
    users: usersList,
    balancesList,
    activeBranchName,
    fundingRequestRecipients,
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
  return (
    <>
      <MarketingFundingPage {...data} />
    </>
  );
}
