import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, getCurrentUser, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { handleExportReportAction } from '~/lib/export-report.server';
import { DisbursementsPage } from '~/features/disbursements/DisbursementsPage';
import type { DisbursementRecord, DisbursementsPageData } from '~/features/disbursements/DisbursementsPage';
import type { FundingRequestRecord } from '~/features/marketing/types';

export const meta: MetaFunction = () => [
  { title: 'Disbursements — Yannis EOSE' },
];

function parseFunding(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: DisbursementRecord[]; pagination: { total: number; page: number; limit: number; totalPages?: number } } } })?.result?.data ?? null;
}

function parseBalancesList(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }> } })?.result?.data;
  return Array.isArray(data) ? data : [];
}

function parseSummary(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
  const data = (res.data as { result?: { data?: { totalSent: string; totalCompleted: string; totalDisputed: string } } })?.result?.data;
  return data ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
}

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

function parseUsersList(res: { ok: boolean; data: unknown }): Array<{ id: string; name: string; email: string; role: string }> {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: { users: Array<{ id: string; name: string; email: string; role: string }> } } })?.result?.data;
  return data?.users ?? [];
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

  const TAB_PAGE_LIMIT = 20;

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
  };

  const listFundingInput: Record<string, unknown> = { page, limit: 20 };
  if (startDate) listFundingInput.startDate = startDate;
  if (endDate) listFundingInput.endDate = endDate;
  if (statusFilter) listFundingInput.status = statusFilter;
  if (receiverFilter) listFundingInput.receiverId = receiverFilter;
  if (searchFilter) listFundingInput.search = searchFilter;

  const [fundingRes, balancesRes, summaryRes, fundingRequestsRes, usersListRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.listFunding?input=${encodeURIComponent(JSON.stringify(listFundingInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(
        JSON.stringify({ page: requestsPage, limit: TAB_PAGE_LIMIT }),
      )}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(`/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`, { method: 'GET', cookie }),
  ]);

  const recipientBalancesAll = parseBalancesList(balancesRes);
  const recipientBalancesTotal = recipientBalancesAll.length;
  const balancesTotalPages = Math.max(1, Math.ceil(recipientBalancesTotal / TAB_PAGE_LIMIT));
  balancesPage = Math.min(balancesPage, balancesTotalPages);
  const recipientBalances = recipientBalancesAll.slice(
    (balancesPage - 1) * TAB_PAGE_LIMIT,
    balancesPage * TAB_PAGE_LIMIT,
  );

  const fundingData = parseFunding(fundingRes);
  const summary = parseSummary(summaryRes);
  let fundingRequestsResult = parseFundingRequests(fundingRequestsRes);
  const requestsTotal = Number(fundingRequestsResult.pagination.total);
  let requestsTotalPages = Math.max(1, Math.ceil(requestsTotal / TAB_PAGE_LIMIT));
  if (requestsPageParam > requestsTotalPages && requestsTotal > 0) {
    requestsPage = requestsTotalPages;
    const retryRes = await apiRequest<unknown>(
      `/trpc/marketing.listFundingRequests?input=${encodeURIComponent(
        JSON.stringify({ page: requestsPage, limit: TAB_PAGE_LIMIT }),
      )}`,
      { method: 'GET', cookie },
    );
    fundingRequestsResult = parseFundingRequests(retryRes);
  }
  const fundingRequests = fundingRequestsResult.records;
  const requestersList = parseUsersList(usersListRes);

  // Finance can only disburse to Head of Marketing. HoM distributes to Media Buyers via Marketing → Funding.
  const users = recipientBalancesAll
    .filter((b) => b.role === 'HEAD_OF_MARKETING')
    .map((b) => ({
      id: b.userId,
      name: b.name,
      email: '',
      role: b.role,
    }));

  const total = fundingData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return {
    funding: fundingData?.records ?? [],
    totalFunding: total,
    totalPages,
    page,
    users,
    canDisburseToHoM,
    canDisburseToMediaBuyers,
    preselectedReceiverId,
    filters,
    recipientBalances,
    recipientBalancesTotal,
    balancesPage,
    balancesTotalPages,
    summary,
    fundingRequests,
    fundingRequestsTotal: requestsTotal,
    requestsPage,
    requestsTotalPages,
    requestersList,
  } satisfies DisbursementsPageData;
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  await requirePermission(request, 'finance.disburse');
  const user = await getCurrentUser(request);
  if (user?.role === 'HEAD_OF_MARKETING') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createFunding') {
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    if (!receiptUrl) {
      return json({ error: 'Receipt URL is mandatory' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.createFunding', {
      method: 'POST',
      cookie,
      body: {
        receiverId: formData.get('receiverId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        receiptUrl,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create disbursement' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveFundingRequest') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    const receiptUrl = formData.get('receiptUrl')?.toString() ?? '';
    if (!requestId || !receiptUrl) {
      return json({ error: 'Request ID and receipt image are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.approveFundingRequest', {
      method: 'POST',
      cookie,
      body: { requestId, receiptUrl },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to approve funding request' }, { status: safeStatus(res.status) });
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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reject funding request' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function DisbursementsRoute() {
  const data = useLoaderData<typeof loader>() as DisbursementsPageData;
  return <DisbursementsPage {...data} />;
}
