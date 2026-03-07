import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, getCurrentUser, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { DisbursementsPage } from '~/features/disbursements/DisbursementsPage';
import type { DisbursementRecord, DisbursementsPageData } from '~/features/disbursements/DisbursementsPage';

export const meta: MetaFunction = () => [
  { title: 'Disbursements — Yannis EOSE' },
];

function parseFunding(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: DisbursementRecord[]; pagination: { total: number; page: number; limit: number; totalPages?: number } } } })?.result?.data ?? null;
}

function parseUsers(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return [];
  return (res.data as { result?: { data?: { users: Array<{ id: string; name: string; email: string; role: string }> } } })?.result?.data?.users ?? [];
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
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canDisburseToHoM = isSuperAdmin || perms.includes('finance.disburse');
  const canDisburseToMediaBuyers = false;

  // Filters from URL
  const statusFilter = url.searchParams.get('status') || undefined;
  const receiverFilter = url.searchParams.get('receiver') || undefined;
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

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
  };

  const listFundingInput: Record<string, unknown> = { page, limit: 20 };
  if (startDate) listFundingInput.startDate = startDate;
  if (endDate) listFundingInput.endDate = endDate;
  if (statusFilter) listFundingInput.status = statusFilter;
  if (receiverFilter) listFundingInput.receiverId = receiverFilter;

  const [fundingRes, usersRes, balancesRes, summaryRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.listFunding?input=${encodeURIComponent(JSON.stringify(listFundingInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: 100 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie }),
  ]);

  const allBalances = parseBalancesList(balancesRes);
  const recipientBalances = allBalances.filter((b) => b.role === 'HEAD_OF_MARKETING');

  const fundingData = parseFunding(fundingRes);
  const users = parseUsers(usersRes);
  const summary = parseSummary(summaryRes);

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
    summary,
  } satisfies DisbursementsPageData;
}

export async function action({ request }: ActionFunctionArgs) {
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function DisbursementsRoute() {
  const data = useLoaderData<typeof loader>() as DisbursementsPageData;
  return <DisbursementsPage {...data} />;
}
