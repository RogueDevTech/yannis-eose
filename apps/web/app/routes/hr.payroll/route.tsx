import { useLoaderData } from '@remix-run/react';
import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { HRPage } from '~/features/hr/HRPage';
import type {
  CommissionPlan,
  Payout,
  Adjustment,
  HRUser,
  PayoutSummary,
  SettlementConfig,
  SettlementPeriod,
  HRStreamData,
  MonthlyPayrollGroup,
  BranchOption,
  ViewerInfo,
} from '~/features/hr/types';

export const meta: MetaFunction = () => [
  { title: 'HR & Payroll — Yannis EOSE' },
];

/**
 * Roles allowed to land on /hr/payroll. HR Manager + admins see everything; Finance Officer
 * (and Finance hat) see batches awaiting disbursement; Heads of Department see their own
 * department's batches. CS / Marketing / Logistics agents have no business here.
 */
const PAYROLL_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Permission gate: hr.read OR one of the allowed roles (Heads + Finance lack hr.read).
  await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('payoutStatus') || undefined;
  const pageParam = Number(url.searchParams.get('payoutPage') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const initialBatchId = url.searchParams.get('batchId');
  const payoutsInput: { page: number; limit: number; status?: string } = { page, limit: 20 };
  if (statusParam && statusParam !== 'ALL') payoutsInput.status = statusParam;

  // Fetch concurrently
  const plansPromise = apiRequest<unknown>('/trpc/hr.listPlans', { method: 'GET', cookie });
  const payoutsPromise = apiRequest<unknown>(
    `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify(payoutsInput))}`,
    { method: 'GET', cookie },
  );
  const adjustmentsPromise = apiRequest<unknown>(`/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({}))}`, { method: 'GET', cookie });
  const summaryPromise = apiRequest<unknown>('/trpc/hr.payoutSummary', { method: 'GET', cookie });
  const usersPromise = apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie });
  const settlementPromise = apiRequest<unknown>('/trpc/hr.getActiveSettlementConfig', { method: 'GET', cookie });
  const periodPromise = apiRequest<unknown>('/trpc/hr.getCurrentSettlementPeriod', { method: 'GET', cookie });
  const monthlyPromise = apiRequest<unknown>(
    `/trpc/hr.listMonthlyPayrolls?input=${encodeURIComponent(JSON.stringify({}))}`,
    { method: 'GET', cookie },
  );
  const branchesPromise = apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });

  // Critical: plans + payouts + monthly batches (the new default tab)
  const [plansRes, payoutsRes, monthlyRes, branchesRes] = await Promise.all([
    plansPromise,
    payoutsPromise,
    monthlyPromise,
    branchesPromise,
  ]);

  const plansData = plansRes.ok
    ? (plansRes.data as { result?: { data?: { plans: CommissionPlan[]; pagination: { total: number } } } })?.result?.data
    : null;

  const payoutsData = payoutsRes.ok
    ? (payoutsRes.data as { result?: { data?: { payouts: Payout[]; pagination: { total: number; page: number; limit: number } } } })?.result?.data
    : null;

  const monthlyData = monthlyRes.ok
    ? (monthlyRes.data as { result?: { data?: { byMonth: MonthlyPayrollGroup[] } } })?.result?.data
    : null;

  const branchesData = branchesRes.ok
    ? (branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data
    : null;

  const [adjustments, payoutSummary, users, settlementConfig, currentPeriod] = await Promise.all([
    adjustmentsPromise.then((res) => res.ok ? ((res.data as { result?: { data?: Adjustment[] } })?.result?.data) ?? [] : []).catch((): Adjustment[] => []),
    summaryPromise.then((res) => res.ok ? ((res.data as { result?: { data?: PayoutSummary } })?.result?.data) ?? {} : {}).catch((): PayoutSummary => ({})),
    usersPromise.then((res) => res.ok ? ((res.data as { result?: { data?: { users: HRUser[] } } })?.result?.data?.users) ?? [] : []).catch((): HRUser[] => []),
    settlementPromise.then((res) => res.ok ? ((res.data as { result?: { data?: SettlementConfig | null } })?.result?.data) ?? null : null).catch((): SettlementConfig | null => null),
    periodPromise.then((res) => res.ok ? ((res.data as { result?: { data?: SettlementPeriod | null } })?.result?.data) ?? null : null).catch((): SettlementPeriod | null => null),
  ]);

  const totalPayouts = payoutsData?.pagination?.total ?? 0;
  const limit = payoutsData?.pagination?.limit ?? 20;
  const totalPayoutPages = Math.max(1, Math.ceil(totalPayouts / limit));

  const viewer: ViewerInfo = {
    id: user.id,
    role: user.role,
    currentBranchId: user.currentBranchId ?? null,
    isFinanceOfficer: user.isFinanceOfficer ?? false,
  };

  return {
    plans: plansData?.plans ?? [],
    totalPlans: plansData?.pagination?.total ?? 0,
    payouts: payoutsData?.payouts ?? [],
    totalPayouts,
    payoutPage: payoutsData?.pagination?.page ?? page,
    totalPayoutPages,
    payoutStatus: statusParam ?? 'ALL',
    adjustments,
    payoutSummary,
    users,
    settlementConfig,
    currentPeriod,
    monthlyPayrolls: monthlyData?.byMonth ?? [],
    branches: branchesData ?? [],
    viewer,
    initialBatchId,
  } satisfies HRStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  // Existing intents (commission plans, legacy payouts, adjustments) — unchanged
  if (intent === 'createPlan') {
    const rules: Record<string, number> = {};
    const baseSalary = formData.get('baseSalary')?.toString();
    const baseThreshold = formData.get('baseThreshold')?.toString();
    const perOrderRate = formData.get('perOrderRate')?.toString();
    const bonusPerExtraOrder = formData.get('bonusPerExtraOrder')?.toString();
    const penaltyPerReturn = formData.get('penaltyPerReturn')?.toString();
    const deliveryRateThreshold = formData.get('deliveryRateThreshold')?.toString();
    if (baseSalary) rules['baseSalary'] = Number(baseSalary);
    if (baseThreshold) rules['baseThreshold'] = Number(baseThreshold);
    if (perOrderRate) rules['perOrderRate'] = Number(perOrderRate);
    if (bonusPerExtraOrder) rules['bonusPerExtraOrder'] = Number(bonusPerExtraOrder);
    if (penaltyPerReturn) rules['penaltyPerReturn'] = Number(penaltyPerReturn);
    if (deliveryRateThreshold) rules['deliveryRateThreshold'] = Number(deliveryRateThreshold);
    const res = await apiRequest<unknown>('/trpc/hr.createPlan', {
      method: 'POST', cookie,
      body: {
        role: formData.get('role')?.toString() ?? '',
        planName: formData.get('planName')?.toString() ?? '',
        rules,
        effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().split('T')[0],
        effectiveTo: formData.get('effectiveTo')?.toString() || undefined,
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to create plan') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'generatePayouts') {
    const res = await apiRequest<unknown>('/trpc/hr.generatePayouts', {
      method: 'POST', cookie,
      body: {
        periodStart: formData.get('periodStart')?.toString() ?? '',
        periodEnd: formData.get('periodEnd')?.toString() ?? '',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to generate payouts') }, { status: safeStatus(res.status) });
    const data = res.data as { result?: { data?: { generated: number } } };
    return json({ success: true, generated: data?.result?.data?.generated ?? 0 });
  }

  if (intent === 'approvePayout') {
    const res = await apiRequest<unknown>('/trpc/hr.approvePayout', {
      method: 'POST', cookie,
      body: {
        payoutId: formData.get('payoutId')?.toString() ?? '',
        status: formData.get('status')?.toString() ?? 'APPROVED',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to update payout') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'createAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.createAdjustment', {
      method: 'POST', cookie,
      body: {
        staffId: formData.get('staffId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        category: formData.get('category')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to create adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'approveAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.approveAdjustment', {
      method: 'POST', cookie,
      body: {
        adjustmentId: formData.get('adjustmentId')?.toString() ?? '',
        approved: true,
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to approve adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'setSettlementConfig') {
    const res = await apiRequest<unknown>('/trpc/hr.setSettlementConfig', {
      method: 'POST', cookie,
      body: {
        windowType: formData.get('windowType')?.toString() ?? 'MONTHLY',
        startDay: Number(formData.get('startDay')?.toString() ?? '1'),
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to update settlement config') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  // ── New: Monthly batch lifecycle intents ────────────────────

  if (intent === 'generateBatch') {
    // periodMonth comes in as YYYY-MM (HTML month input); normalize to YYYY-MM-01
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = /^\d{4}-\d{2}$/.test(rawMonth) ? `${rawMonth}-01` : rawMonth;
    const res = await apiRequest<unknown>('/trpc/hr.generateBatch', {
      method: 'POST', cookie,
      body: {
        branchId: formData.get('branchId')?.toString() ?? '',
        department: formData.get('department')?.toString() ?? '',
        periodMonth,
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to generate batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'submitBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.submitBatch', {
      method: 'POST', cookie,
      body: { batchId: formData.get('batchId')?.toString() ?? '' },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to submit batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'approveBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.approveBatch', {
      method: 'POST', cookie,
      body: {
        batchId: formData.get('batchId')?.toString() ?? '',
        hrNotes: formData.get('hrNotes')?.toString() || undefined,
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to approve batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'rejectBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.rejectBatch', {
      method: 'POST', cookie,
      body: {
        batchId: formData.get('batchId')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to reject batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'markBatchPaid') {
    const res = await apiRequest<unknown>('/trpc/hr.markBatchPaid', {
      method: 'POST', cookie,
      body: {
        batchId: formData.get('batchId')?.toString() ?? '',
        financeReference: formData.get('financeReference')?.toString() ?? '',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to mark batch paid') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'addBatchAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.addBatchAdjustment', {
      method: 'POST', cookie,
      body: {
        batchId: formData.get('batchId')?.toString() ?? '',
        payoutId: formData.get('payoutId')?.toString() ?? '',
        amount: Number(formData.get('amount')?.toString() ?? '0'),
        category: formData.get('category')?.toString() ?? 'OTHER',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to add adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

function extractError(res: { data: unknown }, fallback: string): string {
  const errorData = res.data as { error?: { message?: string } };
  return errorData?.error?.message ?? fallback;
}

export default function HRRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <HRPage
      plans={data.plans}
      totalPlans={data.totalPlans}
      payouts={data.payouts}
      totalPayouts={data.totalPayouts}
      payoutPage={data.payoutPage}
      totalPayoutPages={data.totalPayoutPages}
      payoutStatus={data.payoutStatus}
      adjustments={data.adjustments}
      payoutSummary={data.payoutSummary}
      users={data.users}
      settlementConfig={data.settlementConfig}
      currentPeriod={data.currentPeriod}
      monthlyPayrolls={data.monthlyPayrolls}
      branches={data.branches}
      viewer={data.viewer}
      initialBatchId={data.initialBatchId}
    />
  );
}
