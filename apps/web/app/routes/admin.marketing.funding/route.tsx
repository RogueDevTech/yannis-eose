import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { MarketingFundingPage } from '~/features/marketing/MarketingFundingPage';
import { MarketingFundingLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
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
  // Pass the full user so the helper can honour `isMarketingTeamSupervisorOnActiveBranch`
  // — supervisors get the same chrome as Head of Marketing on this page
  // (CEO directive 2026-05-11). Passing just `user.role` would skip that branch.
  const { isMediaBuyer, isFundingAdmin, canRequestFunding } = getMarketingRoleFlags(user);

  // HoM/Admin can disburse to MBs; Media Buyers cannot. Drives whether Section 2 renders.
  const canDistribute = !isMediaBuyer;

  // ── URL state with safe defaults ────────────────────────
  // Default section is `distributing` for users who can distribute (HoM/Admin)
  // — that's their primary working surface. MBs (no canDistribute) default to
  // `received`. Explicit `?section=received` always wins.
  // Admin-level viewers sit at the top of the funding chain — they only
  // disburse, never receive — so they are pinned to `distributing` regardless
  // of the URL (the `received` tab is hidden for them in the UI).
  const isAdminViewer = isAdminLevel(user);
  const sectionParam = url.searchParams.get('section');
  const activeSection: FundingSection = isAdminViewer
    ? 'distributing'
    : sectionParam === 'received'
      ? 'received'
      : sectionParam === 'balances' && canDistribute
        ? 'balances'
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

  // ── Single bundled call — replaces 14 parallel HTTP round-trips ────
  // The `marketing.fundingPageBundle` procedure runs the same conditional
  // fetch logic (per section, entry type, status) server-side via Promise.all.
  const bundleInput = encodeURIComponent(
    JSON.stringify({
      section: activeSection === 'balances' ? 'distributing' : activeSection,
      entryType: entryTypeFilter,
      page,
      limit: PER_PAGE,
      mergedFetchLimit: MERGED_FETCH_LIMIT,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(transferStatusFilter && { status: transferStatusFilter }),
      ...(requestStatusFilterUnified && { requestStatus: requestStatusFilterUnified }),
      ...(searchFilter && { search: searchFilter }),
    }),
  );
  const bundleP = apiRequest<unknown>(
    `/trpc/marketing.fundingPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie },
  );

  const pageData = (async (): Promise<MarketingFundingLoaderData> => {
  type BundleData = {
    directionSummary: unknown;
    users: Array<{ id: string; name: string; email: string; role: string }>;
    balancesList: Array<{ userId: string; name: string; role: string; totalReceived: string; totalDistributed: string; totalSpend: string; balance: string }> | null;
    fundingBalance: { totalReceived: string; totalDistributed: string; totalSpend: string; balance: string } | null;
    branches: Array<{ id: string; name: string }>;
    fundingRequestRecipients: Array<{
      id: string;
      name: string;
      role: string;
      isFinance: boolean;
      isSupervisor: boolean;
      isPreferred: boolean;
      branchId: string | null;
    }>;
    incomingCounts: { SENT: number; COMPLETED: number; DISPUTED: number; ALL: number };
    myRequestsCounts: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number };
    outgoingCounts: { SENT: number; COMPLETED: number; DISPUTED: number; ALL: number } | null;
    mbRequestsCounts: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number } | null;
    receivedTransfers: { records: unknown[]; pagination: { total: number; page: number; limit: number } } | null;
    receivedRequests: { records: unknown[]; pagination: { total: number; page: number; limit: number } } | null;
    distributingTransfers: { records: unknown[]; pagination: { total: number; page: number; limit: number } } | null;
    distributingRequests: { records: unknown[]; pagination: { total: number; page: number; limit: number } } | null;
  };
  const bundleRes = await bundleP;
  const bundle = bundleRes.ok
    ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
    : null;

  // Synthesize the response shapes the existing parsers expect so the rest
  // of this loader stays unchanged. Each parser accepts `{ ok, data }` and
  // walks `result.data` — wrap our slices accordingly.
  const wrap = <T,>(value: T | null | undefined) => ({
    ok: value != null,
    data: value != null ? { result: { data: value } } : ({} as Record<string, unknown>),
  });
  const receivedTransfersRes = wrap(bundle?.receivedTransfers);
  const receivedRequestsRes = wrap(bundle?.receivedRequests);
  const distributingTransfersRes = wrap(bundle?.distributingTransfers);
  const distributingRequestsRes = wrap(bundle?.distributingRequests);
  const directionSummaryRes = wrap(bundle?.directionSummary);

  // ── Parse counts ────────────────────────────────────────
  const incomingCounts = bundle?.incomingCounts ?? { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
  const myRequestsCounts = bundle?.myRequestsCounts ?? {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    ALL: 0,
  };
  const outgoingCounts = canDistribute
    ? bundle?.outgoingCounts ?? { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 }
    : { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
  const mbRequestsCounts = canDistribute
    ? bundle?.mbRequestsCounts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 }
    : { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };

  // skip flags re-derived locally for the records-hydration math below.
  const isRequestOnlyStatus =
    !!entryStatusParam && (REQUEST_STATUSES as readonly string[]).includes(entryStatusParam);
  const isTransferOnlyStatus =
    !!entryStatusParam && (LEDGER_STATUSES as readonly string[]).includes(entryStatusParam);
  const skipTransfersForStatus = entryTypeFilter !== 'transfer' && isRequestOnlyStatus;
  const skipRequestsForStatus = entryTypeFilter !== 'request' && isTransferOnlyStatus;

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

  const showFundingBalance = user.role === 'MEDIA_BUYER' || user.role === 'HEAD_OF_MARKETING';
  const directionSummary = parseFundingDirectionSummary(directionSummaryRes);
  const fundingBalance = showFundingBalance ? bundle?.fundingBalance ?? undefined : undefined;
  const usersList = bundle?.users ?? [];
  const balancesList = isFundingAdmin ? bundle?.balancesList ?? undefined : undefined;
  const fundingRequestRecipients = canRequestFunding
    ? (bundle?.fundingRequestRecipients ?? []).map((recipient) => ({
        ...recipient,
        isSupervisor: recipient.isSupervisor === true,
      }))
    : [];

  // Resolve active branch name from the bundle's branches list — null if the user has
  // no active branch (admin in global view) or the branch can't be found in the response.
  let activeBranchName: string | null = null;
  if (user.currentBranchId && bundle?.branches) {
    const match = bundle.branches.find((b) => b.id === user.currentBranchId);
    activeBranchName = match?.name ?? null;
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
})();

  return defer({
    fundingShell: {
      filters,
      canDistribute,
      isMediaBuyer,
      isAdminViewer,
      canRequestFunding,
      canSendFunding: isFundingAdmin,
    },
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const result = await runMarketingFundingAction(cookie, formData);
  if (result) return result;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingFundingRoute() {
  const { fundingShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<MarketingFundingLoadingShell {...fundingShell} />}
      loaderShell={{ fundingShell }}
      deferredKey="pageData"
    >
      {(data) => <MarketingFundingPage {...data} />}
    </CachedAwait>
  );
}
