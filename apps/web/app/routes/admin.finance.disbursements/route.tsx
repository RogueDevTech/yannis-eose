import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, getCurrentUser, safeStatus } from '~/lib/api.server';
import { DisbursementsPage } from '~/features/disbursements/DisbursementsPage';
import type { DisbursementRecord, DisbursementsPageData } from '~/features/disbursements/DisbursementsPage';

export const meta: MetaFunction = () => [
  { title: 'Disbursements — Yannis EOSE' },
];

function parseFunding(res: { ok: boolean; data: unknown }) {
  if (!res.ok) return null;
  return (res.data as { result?: { data?: { records: DisbursementRecord[]; pagination: { total: number } } } })?.result?.data ?? null;
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

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.disburse');
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  const url = new URL(request.url);
  const preselectedReceiverId = url.searchParams.get('receiverId') || null;

  const perms = user?.permissions ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canDisburseToHoM = isSuperAdmin || perms.includes('finance.disburse');
  const canDisburseToMediaBuyers = isSuperAdmin || perms.includes('marketing.funding');

  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };
  const listFundingInput: { page: number; limit: number; startDate?: string; endDate?: string } = { page: 1, limit: 100 };
  if (startDate) listFundingInput.startDate = startDate;
  if (endDate) listFundingInput.endDate = endDate;

  const [fundingRes, usersRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.listFunding?input=${encodeURIComponent(JSON.stringify(listFundingInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const balancesRes = await apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie });
  const recipientBalances = parseBalancesList(balancesRes);

  const fundingData = parseFunding(fundingRes);
  const users = parseUsers(usersRes);

  return {
    funding: fundingData?.records ?? [],
    totalFunding: fundingData?.pagination?.total ?? 0,
    users,
    canDisburseToHoM,
    canDisburseToMediaBuyers,
    preselectedReceiverId,
    filters,
    recipientBalances,
  } satisfies DisbursementsPageData;
}

export async function action({ request }: ActionFunctionArgs) {
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
