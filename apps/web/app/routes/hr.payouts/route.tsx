import { useLoaderData } from '@remix-run/react';
import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { PayoutsPage } from '~/features/hr/PayoutsPage';
import type { Payout, PayoutSummary, HRUser } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Payouts — Yannis EOSE' }];

/**
 * Payouts page is for the people who run / fund the actual disbursements:
 *   - SuperAdmin / Admin
 *   - HR Manager (creates batches → produces payouts)
 *   - Finance Officer (and the Finance hat) — disburses
 *
 * Heads of Department are NOT here. They live on /hr/payroll (batches view) and don't
 * need raw per-payout visibility outside their batch.
 */
const PAYOUT_VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  // Finance hat (`isFinanceOfficer`) qualifies even if the primary role isn't FINANCE_OFFICER.
  const isFinanceHat = user.isFinanceOfficer === true;
  if (!isFinanceHat) {
    await requirePermissionOrRoles(request, { roles: PAYOUT_VIEWER_ROLES, permission: 'hr.read' });
  }

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') || undefined;
  const pageParam = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const payoutsInput: { page: number; limit: number; status?: string } = { page, limit: 20 };
  if (statusParam && statusParam !== 'ALL') payoutsInput.status = statusParam;

  const [payoutsRes, summaryRes, usersRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify(payoutsInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/hr.payoutSummary', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie }),
  ]);

  const payoutsData = payoutsRes.ok
    ? (payoutsRes.data as {
        result?: {
          data?: { payouts: Payout[]; pagination: { total: number; page: number; limit: number } };
        };
      })?.result?.data
    : null;

  const summary = summaryRes.ok
    ? ((summaryRes.data as { result?: { data?: PayoutSummary } })?.result?.data ?? {})
    : {};

  const users = usersRes.ok
    ? (((usersRes.data as { result?: { data?: { users: HRUser[] } } })?.result?.data?.users) ?? [])
    : [];

  const total = payoutsData?.pagination?.total ?? 0;
  const limit = payoutsData?.pagination?.limit ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    payouts: payoutsData?.payouts ?? [],
    total,
    page: payoutsData?.pagination?.page ?? page,
    totalPages,
    status: statusParam ?? 'ALL',
    summary,
    users,
    viewer: { role: user.role, isFinanceOfficer: isFinanceHat },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'approvePayout') {
    const res = await apiRequest<unknown>('/trpc/hr.approvePayout', {
      method: 'POST',
      cookie,
      body: {
        payoutId: formData.get('payoutId')?.toString() ?? '',
        status: formData.get('status')?.toString() ?? 'APPROVED',
      },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to update payout';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayoutsRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <PayoutsPage
      payouts={data.payouts}
      total={data.total}
      page={data.page}
      totalPages={data.totalPages}
      status={data.status}
      summary={data.summary}
      users={data.users}
    />
  );
}
