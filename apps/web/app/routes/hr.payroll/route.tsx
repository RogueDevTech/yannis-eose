import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, Await, type ShouldRevalidateFunction } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { HRPage } from '~/features/hr/HRPage';
import { MonthlyPayrollsLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type {
  Adjustment,
  HRUser,
  HRStreamData,
  MonthlyPayrollGroup,
  BranchOption,
  ViewerInfo,
} from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'HR & Payroll — Yannis EOSE' }];

/** Parent `/hr` layout skips GET revalidation; payroll list must refresh after `/hr/payroll/generate`. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ defaultShouldRevalidate }) =>
  defaultShouldRevalidate;

/**
 * Roles allowed to land on /hr/payroll. HR + admins, Heads of Department (auto-scoped to their
 * dept), and Finance Officer (sees PENDING_FINANCE+). CS / Marketing / Logistics agents are not here.
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
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  let allowedByRoleOrPermission = false;
  try {
    await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
    allowedByRoleOrPermission = true;
  } catch {
    allowedByRoleOrPermission = false;
  }

  const url = new URL(request.url);
  const initialBatchId = url.searchParams.get('batchId');
  const prepareAccessRes = await apiRequest<unknown>('/trpc/hr.payrollPrepareAccess', { method: 'GET', cookie });
  const prepareAccessData = prepareAccessRes.ok
    ? (prepareAccessRes.data as {
        result?: { data?: { allowed: boolean; departments: string[]; branches: BranchOption[] } };
      })?.result?.data
    : null;
  if (!allowedByRoleOrPermission && !prepareAccessData?.allowed) {
    throw redirect('/admin');
  }

  const pageData = (async (): Promise<HRStreamData> => {
  // Critical: monthly batches + branches (the default view)
  // Secondary: adjustments + users (only mounted for HR/Finance via the Adjustments tab)
  const [monthlyRes, branchesRes, adjustmentsRes, usersRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/hr.listMonthlyPayrolls?input=${encodeURIComponent(JSON.stringify({}))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({}))}`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.list', { method: 'GET', cookie }),
  ]);

  const monthlyData = monthlyRes.ok
    ? (monthlyRes.data as { result?: { data?: { byMonth: MonthlyPayrollGroup[] } } })?.result?.data
    : null;
  const branchesData = branchesRes.ok
    ? (branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data
    : (prepareAccessData?.branches ?? null);
  const adjustments = adjustmentsRes.ok
    ? ((adjustmentsRes.data as { result?: { data?: Adjustment[] } })?.result?.data ?? [])
    : [];
  const users = usersRes.ok
    ? (((usersRes.data as { result?: { data?: { users: HRUser[] } } })?.result?.data?.users) ?? [])
    : [];

  const viewer: ViewerInfo = {
    id: user.id,
    role: user.role,
    currentBranchId: user.currentBranchId ?? null,
    prepareDepartments: (prepareAccessData?.departments ?? []) as ViewerInfo['prepareDepartments'],
    prepareBranchIds: (prepareAccessData?.branches ?? []).map((b) => b.id),
  };

  return {
    adjustments,
    users,
    monthlyPayrolls: monthlyData?.byMonth ?? [],
    branches: branchesData ?? [],
    viewer,
    initialBatchId,
  } satisfies HRStreamData;
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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
    if (!res.ok) return json({ error: extractError(res, 'Failed to create adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'approveAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.approveAdjustment', {
      method: 'POST',
      cookie,
      body: { adjustmentId: formData.get('adjustmentId')?.toString() ?? '', approved: true },
    });
    if (!res.ok) return json({ error: extractError(res, 'Failed to approve adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  // ── Monthly batch lifecycle intents ────────────────────────

  if (intent === 'generateBatch') {
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
      body: { batchId: formData.get('batchId')?.toString() ?? '', reason: formData.get('reason')?.toString() ?? '' },
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
  return extractApiErrorMessage(res.data, fallback);
}

export default function HRRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MonthlyPayrollsLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
          <HRPage
            adjustments={data.adjustments}
            users={data.users}
            monthlyPayrolls={data.monthlyPayrolls}
            branches={data.branches}
            viewer={data.viewer}
            initialBatchId={data.initialBatchId}
          />
        )}
    </CachedAwait>
  );
}
