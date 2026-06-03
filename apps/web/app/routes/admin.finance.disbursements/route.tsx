import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import type { ShouldRevalidateFunctionArgs } from '@remix-run/react';
import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, getCurrentUser, safeStatus, defaultThisMonthRange, parsePerPage } from '~/lib/api.server';
import { USERS_LIST_MAX_LIMIT } from '~/lib/trpc-list-limits';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import { DisbursementsPage } from '~/features/disbursements/DisbursementsPage';
import { FinanceDisbursementsLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
import type { DisbursementRecord, DisbursementsPageData } from '~/features/disbursements/DisbursementsPage';
import type { FundingRequestRecord } from '~/features/marketing/types';

export const meta: MetaFunction = () => [
  { title: 'Disbursements — Yannis EOSE' },
];

/** Skip loader when only `tab` changes — all tab payloads are fetched in one loader run. */
function normalizeSearchExcludingTab(search: string): string {
  const sp = new URLSearchParams(search);
  sp.delete('tab');
  const entries = [...sp.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function shouldRevalidate({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs): boolean {
  const cur = new URL(currentUrl);
  const nex = new URL(nextUrl);
  if (cur.pathname !== nex.pathname) return true;
  // Same location (e.g. fetcher/action completed) — must revalidate so tables refresh.
  if (cur.pathname === nex.pathname && cur.search === nex.search) return true;
  // URLs differ only by `tab` — single loader already has all tab slices.
  if (normalizeSearchExcludingTab(cur.search) === normalizeSearchExcludingTab(nex.search)) {
    return false;
  }
  return true;
}

/** Retry parser kept for the rare `requestsPage` overshoot path that re-queries
 *  `marketing.listFundingRequests` directly. The other 5 endpoints are served
 *  by the bundle and don't need standalone parsers anymore. */
function parseFundingRequests(res: { ok: boolean; data: unknown }): {
  records: FundingRequestRecord[];
  pagination: { page: number; limit: number; total: number };
} {
  if (!res.ok) {
    return { records: [], pagination: { page: 1, limit: 20, total: 0 } };
  }
  const data = (res.data as {
    result?: { data?: { records: FundingRequestRecord[]; pagination: { page: number; limit: number; total: number } } };
  })?.result?.data;
  return {
    records: data?.records ?? [],
    pagination: data?.pagination ?? { page: 1, limit: 20, total: 0 },
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.disburse');
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);

  // This page is for Finance → Head of Marketing only. HoM distributes to Media Buyers from Marketing → Funding.
  if (user?.role === 'HEAD_OF_MARKETING') {
    throw new Response(null, { status: 403, statusText: 'Forbidden' });
  }

  const url = new URL(request.url);
  const preselectedReceiverId = url.searchParams.get('receiverId') || null;

  const perms = user?.permissions ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canDisburseToHoM = isSuperAdmin || perms.includes('finance.disburse');
  const canDisburseToMediaBuyers = false;

  // Filters from URL
  const statusFilter = url.searchParams.get('status') || undefined;
  const receiverFilter = url.searchParams.get('receiver') || undefined;
  // `search` matches against sender name, receiver name, or funding row ID server-side
  // (see marketing.service.ts → listFunding). Trimmed to 200 chars per the Zod schema.
  const searchFilter = url.searchParams.get('search')?.trim() || undefined;
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  const balancesPageParam = parseInt(url.searchParams.get('balancesPage') || '1', 10);
  let balancesPage = isNaN(balancesPageParam) || balancesPageParam < 1 ? 1 : balancesPageParam;

  const requestsPageParam = parseInt(url.searchParams.get('requestsPage') || '1', 10);
  let requestsPage = isNaN(requestsPageParam) || requestsPageParam < 1 ? 1 : requestsPageParam;
  const balancesSearch = url.searchParams.get('balancesSearch')?.trim() || '';
  const balancesRole = url.searchParams.get('balancesRole') || '';
  const balancesStatus = url.searchParams.get('balancesStatus') || '';

  // URL-driven page sizes — one param per paginated table (funding / requests / balances).
  const { perPage } = parsePerPage(url.searchParams);
  const { perPage: requestsPerPage } = parsePerPage(url.searchParams, { param: 'requestsPerPage' });
  const { perPage: balancesPerPage } = parsePerPage(url.searchParams, { param: 'balancesPerPage' });

  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const filters = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
    status: statusFilter ?? '',
    receiver: receiverFilter ?? '',
    search: searchFilter ?? '',
    balancesSearch,
    balancesRole,
    balancesStatus,
  };

  const disbursementsShell = { filters };

  const pageData = (async (): Promise<DisbursementsPageData> => {
  // Single bundled call — replaces 6 parallel tRPC HTTP round-trips with one.
  // Backend (`marketing.disbursementsPageBundle`) fans out the same six service
  // calls in parallel inside a single request handler.
  const bundleInput = encodeURIComponent(
    JSON.stringify({
      page,
      limit: perPage,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(statusFilter && { status: statusFilter }),
      ...(receiverFilter && { receiverId: receiverFilter }),
      ...(searchFilter && { search: searchFilter }),
      requestsPage,
      requestsLimit: requestsPerPage,
      usersLimit: USERS_LIST_MAX_LIMIT,
    }),
  );
  const bundleRes = await apiRequest<unknown>(
    `/trpc/marketing.disbursementsPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie },
  );
  type BundleData = {
    funding: { records: DisbursementRecord[]; pagination: { total: number; page: number; limit: number; totalPages?: number }; filteredTotalAmount?: string } | null;
    balances: Array<{ userId: string; name: string; role: string; totalReceived: string; totalDistributed: string; totalSpend: string; balance: string }>;
    summary: { totalSent: string; totalCompleted: string; totalDisputed: string; sentCount: number; completedCount: number; disputedCount: number };
    requests: { records: FundingRequestRecord[]; pagination: { page: number; limit: number; total: number } };
    requestsCounts: { PENDING: number; APPROVED: number; REJECTED: number; ALL: number };
    users: Array<{ id: string; name: string; email: string; role: string }>;
  };
  const bundle = bundleRes.ok
    ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
    : null;

  const recipientBalancesAll = (bundle?.balances ?? []).filter(
    // Finance disburses to HoM only — MB balances are the HoM's concern (Marketing → Funding page).
    // Only show HoMs who have actually received funding from Finance.
    (b) => b.role === 'HEAD_OF_MARKETING' && Number(b.totalReceived) > 0,
  );
  const filteredRecipientBalancesAll = recipientBalancesAll.filter((b) => {
    const roleMatch = !balancesRole || balancesRole === 'ALL' || b.role === balancesRole;
    const searchMatch = !balancesSearch || b.name.toLowerCase().includes(balancesSearch.toLowerCase());
    const balanceValue = Number(b.balance);
    const statusMatch = !balancesStatus
      || balancesStatus === 'ALL'
      || (balancesStatus === 'POSITIVE' && balanceValue > 0)
      || (balancesStatus === 'ZERO' && balanceValue === 0)
      || (balancesStatus === 'NEGATIVE' && balanceValue < 0);
    return roleMatch && searchMatch && statusMatch;
  });
  const recipientBalancesTotal = filteredRecipientBalancesAll.length;
  const balancesTotalPages = Math.max(1, Math.ceil(recipientBalancesTotal / balancesPerPage));
  balancesPage = Math.min(balancesPage, balancesTotalPages);
  const recipientBalances = filteredRecipientBalancesAll.slice(
    (balancesPage - 1) * balancesPerPage,
    balancesPage * balancesPerPage,
  );

  const fundingData = bundle?.funding ?? null;
  const summary = bundle?.summary ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0', sentCount: 0, completedCount: 0, disputedCount: 0 };
  let fundingRequestsResult = bundle?.requests ?? { records: [], pagination: { page: 1, limit: 20, total: 0 } };
  const requestsTotal = Number(fundingRequestsResult.pagination.total);
  let requestsTotalPages = Math.max(1, Math.ceil(requestsTotal / requestsPerPage));
  if (requestsPageParam > requestsTotalPages && requestsTotal > 0) {
    requestsPage = requestsTotalPages;
    const retryRes = await apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(
        JSON.stringify({
          page: requestsPage,
          limit: requestsPerPage,
          // Keep the overshoot-retry consistent with the bundle: Finance
          // Disbursements only lists Head of Marketing funding requests.
          requesterRole: 'HEAD_OF_MARKETING',
        }),
      )}`,
      { method: 'GET', cookie },
    );
    fundingRequestsResult = parseFundingRequests(retryRes);
  }
  const fundingRequests = fundingRequestsResult.records;
  const fundingRequestStatusCounts = bundle?.requestsCounts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
  const requestersList = bundle?.users ?? [];

  // Finance can only disburse to Head of Marketing. HoM distributes to Media Buyers via Marketing → Funding.
  // Include ALL HoM users from the balances list (not just those with totalReceived > 0)
  // so that first-time recipients appear in the dropdown.
  const allBalances = bundle?.balances ?? [];
  const users = allBalances
    .filter((b) => b.role === 'HEAD_OF_MARKETING')
    .map((b) => ({
      id: b.userId,
      name: b.name,
      email: '',
      role: b.role,
    }));

  const total = fundingData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  return {
    funding: fundingData?.records ?? [],
    filteredTotalAmount: fundingData?.filteredTotalAmount ?? '0',
    totalFunding: total,
    totalPages,
    page,
    perPage,
    users,
    canDisburseToHoM,
    canDisburseToMediaBuyers,
    preselectedReceiverId,
    filters,
    recipientBalances,
    recipientBalancesTotal,
    balancesPage,
    balancesTotalPages,
    balancesPerPage,
    summary,
    fundingRequests,
    fundingRequestsTotal: requestsTotal,
    fundingRequestStatusCounts,
    requestsPage,
    requestsTotalPages,
    requestsPerPage,
    requestersList,
  } satisfies DisbursementsPageData;
  })();

  return defer({ disbursementsShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  await requirePermission(request, 'finance.disburse');
  const user = await getCurrentUser(request);
  if (user?.role === 'HEAD_OF_MARKETING') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const formData = await request.clone().formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createFunding') {
    const receiptUrl = formData.get('receiptUrl')?.toString() || undefined;
    const res = await apiRequest<unknown>('/trpc/marketing.createFunding', {
      method: 'POST',
      cookie,
      body: {
        receiverId: formData.get('receiverId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        ...(receiptUrl ? { receiptUrl } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create disbursement') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    const amountRaw = formData.get('amount')?.toString() ?? '';
    const amount = Number(amountRaw);
    if (!requestId) {
      return json({ error: 'Request ID is required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: 'Valid approved amount is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.approveFundingRequest', {
      method: 'POST',
      cookie,
      body: { requestId, amount, ...(receiptUrl ? { receiptUrl } : {}) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve funding request') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'rejectFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    if (!requestId) {
      return json({ error: 'Request ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.rejectFundingRequest', {
      method: 'POST',
      cookie,
      body: {
        requestId,
        reason: formData.get('reason')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject funding request') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function DisbursementsRoute() {
  const { disbursementsShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<FinanceDisbursementsLoadingShell filters={disbursementsShell.filters} />}
      loaderShell={{ disbursementsShell }}
      deferredKey="pageData"
    >
      {(data) => <DisbursementsPage {...(data as DisbursementsPageData)} />}
    </CachedAwait>
  );
}
