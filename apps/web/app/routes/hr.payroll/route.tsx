import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
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
} from '~/features/hr/types';

export const meta: MetaFunction = () => [
  { title: 'HR & Payroll — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'hr.read');
  const cookie = getSessionCookie(request);

  // ── Start ALL fetches concurrently ────────────────────────────
  const plansPromise = apiRequest<unknown>('/trpc/hr.listPlans', { method: 'GET', cookie });
  const payoutsPromise = apiRequest<unknown>('/trpc/hr.listPayouts', { method: 'GET', cookie });
  const adjustmentsPromise = apiRequest<unknown>(`/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({}))}`, { method: 'GET', cookie });
  const summaryPromise = apiRequest<unknown>('/trpc/hr.payoutSummary', { method: 'GET', cookie });
  const usersPromise = apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie });
  const settlementPromise = apiRequest<unknown>('/trpc/hr.getActiveSettlementConfig', { method: 'GET', cookie });
  const periodPromise = apiRequest<unknown>('/trpc/hr.getCurrentSettlementPeriod', { method: 'GET', cookie });

  // ── Await ONLY critical data (plans + payouts) ────────────────
  const [plansRes, payoutsRes] = await Promise.all([plansPromise, payoutsPromise]);

  const plansData = plansRes.ok
    ? (plansRes.data as { result?: { data?: { plans: CommissionPlan[]; pagination: { total: number } } } })?.result?.data
    : null;

  const payoutsData = payoutsRes.ok
    ? (payoutsRes.data as { result?: { data?: { payouts: Payout[]; pagination: { total: number } } } })?.result?.data
    : null;

  // Await secondary data in parallel
  const [adjustments, payoutSummary, users, settlementConfig, currentPeriod] = await Promise.all([
    adjustmentsPromise
      .then((res) => {
        if (!res.ok) return [];
        return ((res.data as { result?: { data?: Adjustment[] } })?.result?.data) ?? [];
      })
      .catch((): Adjustment[] => []),

    summaryPromise
      .then((res) => {
        if (!res.ok) return {};
        return ((res.data as { result?: { data?: PayoutSummary } })?.result?.data) ?? {};
      })
      .catch((): PayoutSummary => ({})),

    usersPromise
      .then((res) => {
        if (!res.ok) return [];
        return ((res.data as { result?: { data?: { users: HRUser[] } } })?.result?.data?.users) ?? [];
      })
      .catch((): HRUser[] => []),

    settlementPromise
      .then((res) => {
        if (!res.ok) return null;
        return ((res.data as { result?: { data?: SettlementConfig | null } })?.result?.data) ?? null;
      })
      .catch((): SettlementConfig | null => null),

    periodPromise
      .then((res) => {
        if (!res.ok) return null;
        return ((res.data as { result?: { data?: SettlementPeriod | null } })?.result?.data) ?? null;
      })
      .catch((): SettlementPeriod | null => null),
  ]);

  return {
    plans: plansData?.plans ?? [],
    totalPlans: plansData?.pagination?.total ?? 0,
    payouts: payoutsData?.payouts ?? [],
    totalPayouts: payoutsData?.pagination?.total ?? 0,
    adjustments,
    payoutSummary,
    users,
    settlementConfig,
    currentPeriod,
  } satisfies HRStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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
      method: 'POST',
      cookie,
      body: {
        role: formData.get('role')?.toString() ?? '',
        planName: formData.get('planName')?.toString() ?? '',
        rules,
        effectiveFrom: formData.get('effectiveFrom')?.toString() ?? new Date().toISOString().split('T')[0],
        effectiveTo: formData.get('effectiveTo')?.toString() || undefined,
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create plan' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'generatePayouts') {
    const res = await apiRequest<unknown>('/trpc/hr.generatePayouts', {
      method: 'POST',
      cookie,
      body: {
        periodStart: formData.get('periodStart')?.toString() ?? '',
        periodEnd: formData.get('periodEnd')?.toString() ?? '',
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to generate payouts' }, { status: safeStatus(res.status) });
    }
    const data = res.data as { result?: { data?: { generated: number } } };
    return json({ success: true, generated: data?.result?.data?.generated ?? 0 });
  }

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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update payout' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'createAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.createAdjustment', {
      method: 'POST',
      cookie,
      body: {
        staffId: formData.get('staffId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        category: formData.get('category')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create adjustment' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'approveAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.approveAdjustment', {
      method: 'POST',
      cookie,
      body: {
        adjustmentId: formData.get('adjustmentId')?.toString() ?? '',
        approved: true,
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to approve adjustment' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'setSettlementConfig') {
    const res = await apiRequest<unknown>('/trpc/hr.setSettlementConfig', {
      method: 'POST',
      cookie,
      body: {
        windowType: formData.get('windowType')?.toString() ?? 'MONTHLY',
        startDay: Number(formData.get('startDay')?.toString() ?? '1'),
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update settlement config' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function HRRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <HRPage
      plans={data.plans}
      totalPlans={data.totalPlans}
      payouts={data.payouts}
      totalPayouts={data.totalPayouts}
      adjustments={data.adjustments}
      payoutSummary={data.payoutSummary}
      users={data.users}
      settlementConfig={data.settlementConfig}
      currentPeriod={data.currentPeriod}
    />
  );
}
