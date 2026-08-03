import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, type ShouldRevalidateFunction } from '@remix-run/react';
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

/** Map a calendar day to payroll period month (`YYYY-MM-01`). */
function periodMonthFromYmd(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return `${ymd.slice(0, 7)}-01`;
}

/** Return current month boundaries as YYYY-MM-DD strings. */
function currentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const defaults = currentMonthRange();
  const startDate = url.searchParams.get('startDate') || defaults.startDate;
  const endDate = url.searchParams.get('endDate') || defaults.endDate;

  const fromMonth = periodAllTime ? undefined : (periodMonthFromYmd(startDate) ?? undefined);
  const toMonth = periodAllTime ? undefined : (periodMonthFromYmd(endDate) ?? undefined);

  let allowedByRoleOrPermission = false;
  try {
    await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
    allowedByRoleOrPermission = true;
  } catch {
    allowedByRoleOrPermission = false;
  }

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
    const bundleInput: Record<string, string> = {};
    if (fromMonth) bundleInput.fromMonth = fromMonth;
    if (toMonth) bundleInput.toMonth = toMonth;

    const bundleRes = await apiRequest<unknown>(
      `/trpc/hr.payrollPageBundle?input=${encodeURIComponent(JSON.stringify(bundleInput))}`,
      { method: 'GET', cookie },
    );

    const bundle = bundleRes.ok
      ? (bundleRes.data as {
          result?: {
            data?: {
              payrolls?: { byMonth: MonthlyPayrollGroup[] };
              adjustments?: Adjustment[];
              users?: HRUser[];
              contractors?: Array<{ id: string; name: string }>;
              branches?: BranchOption[];
            };
          };
        })?.result?.data
      : null;

    const viewer: ViewerInfo = {
      id: user.id,
      role: user.role,
      currentBranchId: user.currentBranchId ?? null,
      permissions: user.permissions ?? [],
      prepareDepartments: (prepareAccessData?.departments ?? []) as ViewerInfo['prepareDepartments'],
      prepareBranchIds: (prepareAccessData?.branches ?? []).map((b) => b.id),
    };

    return {
      adjustments: bundle?.adjustments ?? [],
      users: bundle?.users ?? [],
      contractors: (bundle?.contractors ?? []).map((c) => ({ id: c.id, name: c.name })),
      monthlyPayrolls: bundle?.payrolls?.byMonth ?? [],
      branches: bundle?.branches ?? prepareAccessData?.branches ?? [],
      viewer,
      filters: { startDate, endDate, periodAllTime },
    };
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
    // The selector value is prefixed `staff:` or `contractor:` so a single
    // dropdown can target either party type. Route to the matching id field.
    const party = formData.get('staffId')?.toString() ?? '';
    const [partyType, partyId] = party.includes(':') ? party.split(':', 2) : ['staff', party];
    // Target month: accept YYYY-MM (month input) or YYYY-MM-01; omit when blank
    // so the adjustment attaches to the next batch regardless of month (legacy).
    const rawAdjMonth = formData.get('periodMonth')?.toString() ?? '';
    const adjPeriodMonth = /^\d{4}-\d{2}$/.test(rawAdjMonth)
      ? `${rawAdjMonth}-01`
      : /^\d{4}-\d{2}-01$/.test(rawAdjMonth)
        ? rawAdjMonth
        : undefined;
    const res = await apiRequest<unknown>('/trpc/hr.createAdjustment', {
      method: 'POST',
      cookie,
      body: {
        ...(partyType === 'contractor' ? { contractorId: partyId } : { staffId: partyId }),
        amount: formData.get('amount')?.toString() ?? '',
        category: formData.get('category')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
        ...(adjPeriodMonth ? { periodMonth: adjPeriodMonth } : {}),
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
        includeContractors: formData.get('includeContractors') === 'on',
        runLabel: formData.get('runLabel')?.toString() || undefined,
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
        disbursementDate: formData.get('disbursementDate')?.toString() || undefined,
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

export default function HRPayrollIndexRoute() {
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
          contractors={data.contractors}
          monthlyPayrolls={data.monthlyPayrolls}
          branches={data.branches}
          viewer={data.viewer}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
