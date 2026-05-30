import { useLoaderData, Await } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PayrollGeneratePage } from '~/features/hr/PayrollGeneratePage';
import { GeneratePayrollLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { BranchOption, ViewerInfo } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Generate Payroll Batch — Yannis EOSE' }];

const PAYROLL_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

function normalizePeriodMonth(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-01$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return s;
}

function unwrapTrpcMutation<T>(data: unknown): T | undefined {
  return (data as { result?: { data?: T } } | undefined)?.result?.data;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const sessionUser = await getCurrentUser(request);
  if (!sessionUser) throw redirect('/auth');

  let allowedByRoleOrPermission = false;
  try {
    await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
    allowedByRoleOrPermission = true;
  } catch {
    allowedByRoleOrPermission = false;
  }

  const cookie = getSessionCookie(request);
  const prepareAccessRes = await apiRequest<unknown>('/trpc/hr.payrollPrepareAccess', { method: 'GET', cookie });
  const prepareAccessData = prepareAccessRes.ok
    ? (prepareAccessRes.data as {
        result?: { data?: { allowed: boolean; departments: string[]; branches: BranchOption[] } };
      })?.result?.data
    : null;

  if (!allowedByRoleOrPermission && !prepareAccessData?.allowed) {
    throw redirect('/admin');
  }

  if (!prepareAccessData?.allowed) {
    throw redirect('/hr/payroll');
  }

  const branchesRes = await apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });
  const branchesData = branchesRes.ok
    ? (branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data
    : (prepareAccessData?.branches ?? []);

  const viewer: ViewerInfo = {
    id: sessionUser.id,
    role: sessionUser.role,
    currentBranchId: sessionUser.currentBranchId ?? null,
    prepareDepartments: (prepareAccessData?.departments ?? []) as ViewerInfo['prepareDepartments'],
    prepareBranchIds: (prepareAccessData?.branches ?? []).map((b) => b.id),
  };

  const pageData = (async () => ({
    branches: branchesData ?? [],
    viewer,
  }))();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'previewBatch') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = normalizePeriodMonth(rawMonth);
    const res = await apiRequest<unknown>('/trpc/hr.previewBatch', {
      method: 'POST',
      cookie,
      body: {
        branchId: formData.get('branchId')?.toString() ?? '',
        department: formData.get('department')?.toString() ?? '',
        periodMonth,
      },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to preview batch') },
        { status: safeStatus(res.status) },
      );
    }
    const preview = unwrapTrpcMutation<unknown>(res.data) ?? null;
    return json({ success: true, preview });
  }

  if (intent === 'generateBatch') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = normalizePeriodMonth(rawMonth);
    const res = await apiRequest<unknown>('/trpc/hr.generateBatch', {
      method: 'POST',
      cookie,
      body: {
        branchId: formData.get('branchId')?.toString() ?? '',
        department: formData.get('department')?.toString() ?? '',
        periodMonth,
      },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to generate batch') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = unwrapTrpcMutation<{ batchId?: string }>(res.data);
    const batchId = payload?.batchId;
    if (batchId) {
      throw redirect(`/hr/payroll?batchId=${encodeURIComponent(batchId)}`);
    }
    throw redirect('/hr/payroll');
  }

  if (intent === 'generateBatchesBulk') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = normalizePeriodMonth(rawMonth);
    const branchIds = Array.from(formData.getAll('branchIds'))
      .map((v) => v.toString().trim())
      .filter(Boolean);
    const departments = Array.from(formData.getAll('departments'))
      .map((v) => v.toString().trim())
      .filter(Boolean);

    if (branchIds.length === 0 || departments.length === 0) {
      return json({ error: 'Choose at least one branch and one department.' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/hr.generateBatchesBulk', {
      method: 'POST',
      cookie,
      body: { branchIds, departments, periodMonth },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to generate batches') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = unwrapTrpcMutation<{ summaryMessage?: string }>(res.data);
    const summaryMessage = payload?.summaryMessage ?? 'Batches processed';
    throw redirect(`/hr/payroll?generateSummary=${encodeURIComponent(summaryMessage)}`);
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function HrPayrollGenerateRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<GeneratePayrollLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => <PayrollGeneratePage branches={data.branches} viewer={data.viewer} />}
      </Await>
    </Suspense>
  );
}
