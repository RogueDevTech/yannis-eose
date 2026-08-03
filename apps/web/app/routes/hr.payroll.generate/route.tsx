import { useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
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
        result?: {
          data?: {
            allowed: boolean;
            departments: string[];
            branches: BranchOption[];
            unassignedStaffCount?: number;
          };
        };
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
    unassignedStaffCount: prepareAccessData?.unassignedStaffCount ?? 0,
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
    const branchIds = Array.from(formData.getAll('branchIds'))
      .map((v) => v.toString().trim())
      .filter(Boolean);
    const branchId = formData.get('branchId')?.toString() || branchIds[0] || '';
    const res = await apiRequest<unknown>('/trpc/hr.previewBatch', {
      method: 'POST',
      cookie,
      body: {
        branchId,
        department: formData.get('department')?.toString() ?? '',
        periodMonth,
        scopeType: branchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT',
        scopeBranchIds: branchIds.length > 0 ? branchIds : undefined,
        includeNullBranch: formData.get('includeNullBranch') === 'on',
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

  if (intent === 'previewSelection') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = normalizePeriodMonth(rawMonth);
    const explicitScopeType = formData.get('scopeType')?.toString() || undefined;
    const isNullScope = explicitScopeType === 'CONTRACTORS' || explicitScopeType === 'ALL';
    const branchIds = Array.from(formData.getAll('branchIds'))
      .map((v) => v.toString().trim())
      .filter(Boolean);
    const departments = Array.from(formData.getAll('departments'))
      .map((v) => v.toString().trim())
      .filter(Boolean);
    const rawBranchId = formData.get('branchId')?.toString() || branchIds[0] || undefined;
    const scopeType = explicitScopeType ?? (branchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT');
    const res = await apiRequest<unknown>('/trpc/hr.previewSelection', {
      method: 'POST',
      cookie,
      // A whole-selection preview computes full commission math per staff member
      // across every selected department, so give it a generous budget (default
      // mutation timeout is 30s — too tight for a large all-departments run).
      timeoutMs: 120_000,
      body: {
        // ALL carries no branch; CONTRACTORS may pin a single branch.
        branchId: explicitScopeType === 'ALL' ? undefined : rawBranchId,
        periodMonth,
        scopeType,
        scopeBranchIds: !isNullScope && branchIds.length > 0 ? branchIds : undefined,
        departments: !isNullScope && departments.length > 0 ? departments : undefined,
        includeNullBranch: !isNullScope && formData.get('includeNullBranch') === 'on',
      },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to preview selection') },
        { status: safeStatus(res.status) },
      );
    }
    const selectionPreview = unwrapTrpcMutation<unknown>(res.data) ?? null;
    return json({ success: true, selectionPreview });
  }

  if (intent === 'generateBatch') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = normalizePeriodMonth(rawMonth);
    const explicitScopeType = formData.get('scopeType')?.toString() || undefined;
    const isNullScope = explicitScopeType === 'CONTRACTORS' || explicitScopeType === 'ALL';
    const branchIds = Array.from(formData.getAll('branchIds'))
      .map((v) => v.toString().trim())
      .filter(Boolean);
    const rawBranchId = formData.get('branchId')?.toString() || branchIds[0] || '';
    const rawDepartment = formData.get('department')?.toString() || undefined;
    const scopeType = explicitScopeType ?? (branchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT');
    const res = await apiRequest<unknown>('/trpc/hr.generateBatch', {
      method: 'POST',
      cookie,
      // Generation computes + inserts a payout per staff member across the whole
      // selection, so give it a generous budget (default mutation timeout is 30s).
      timeoutMs: 180_000,
      body: {
        // ALL carries no branch/department; CONTRACTORS may pin a single branch only.
        branchId: explicitScopeType === 'ALL' ? undefined : rawBranchId || undefined,
        department: isNullScope ? undefined : rawDepartment,
        periodMonth,
        scopeType,
        scopeBranchIds: !isNullScope && branchIds.length > 0 ? branchIds : undefined,
        includeContractors: formData.get('includeContractors') === 'on',
        includeNullBranch: !isNullScope && formData.get('includeNullBranch') === 'on',
        runLabel: formData.get('runLabel')?.toString() || undefined,
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
    const explicitScopeType = formData.get('scopeType')?.toString() || undefined;
    const isNullScope = explicitScopeType === 'CONTRACTORS' || explicitScopeType === 'ALL';

    // CONTRACTORS / ALL route to a single null-scope batch (empty arrays allowed).
    if (!isNullScope && (branchIds.length === 0 || departments.length === 0)) {
      return json({ error: 'Choose at least one branch and one department.' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/hr.generateBatchesBulk', {
      method: 'POST',
      cookie,
      // Fan-out generation computes + inserts a payout per staff member for every
      // (branch × department) slot, so give it a generous budget.
      timeoutMs: 180_000,
      body: {
        branchIds: isNullScope ? [] : branchIds,
        departments: isNullScope ? [] : departments,
        periodMonth,
        scopeType: explicitScopeType,
        combineBranches: !isNullScope && (formData.get('combineBranches') === 'on' || branchIds.length > 1),
        includeContractors: formData.get('includeContractors') === 'on',
        includeNullBranch: !isNullScope && formData.get('includeNullBranch') === 'on',
        runLabel: formData.get('runLabel')?.toString() || undefined,
      },
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
    <CachedAwait
      resolve={pageData}
      fallback={<GeneratePayrollLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => <PayrollGeneratePage branches={data.branches} viewer={data.viewer} />}
    </CachedAwait>
  );
}
