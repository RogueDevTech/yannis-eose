import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { PayrollBatchDetailPage, type BatchDetail } from '~/features/hr/PayrollBatchDetailPage';
import { PayrollBatchDetailLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { ViewerInfo, BranchOption } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Payroll Batch — Yannis EOSE' }];

const PAYROLL_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Not authenticated', { status: 401 });
  await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
  const cookie = getSessionCookie(request);
  const batchId = params['id'];
  if (!batchId) throw new Response('Batch ID required', { status: 400 });

  const pageData = (async () => {
    const [batchRes, prepareRes, branchesRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/hr.getBatch?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/hr.payrollPrepareAccess', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    ]);

    if (!batchRes.ok) throw new Response('Batch not found', { status: 404 });
    const detail = (batchRes.data as { result?: { data?: BatchDetail } })?.result?.data ?? null;
    if (!detail) throw new Response('Batch not found', { status: 404 });

    const prepareData = prepareRes.ok
      ? (prepareRes.data as { result?: { data?: { departments: string[]; branches: BranchOption[] } } })?.result?.data
      : null;

    const branchRows = branchesRes.ok
      ? (branchesRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? []
      : [];
    // Null for null-scope (contractor / ALL) batches — the detail page renders a
    // scope-aware fallback via batchBranchLabel.
    const branchName = detail.batch.branchId
      ? (branchRows.find((b) => b.id === detail.batch.branchId)?.name ?? detail.batch.branchId.slice(0, 8))
      : null;

    const viewer: ViewerInfo = {
      id: user.id,
      role: user.role,
      currentBranchId: user.currentBranchId ?? null,
      prepareDepartments: (prepareData?.departments ?? []) as ViewerInfo['prepareDepartments'],
      prepareBranchIds: (prepareData?.branches ?? []).map((b) => b.id),
    };

    return { detail, branchName, viewer };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'submitBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.submitBatch', {
      method: 'POST', cookie,
      body: { batchId: formData.get('batchId')?.toString() ?? '' },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to submit batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'deleteBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.deleteBatch', {
      method: 'POST', cookie,
      body: { batchId: formData.get('batchId')?.toString() ?? '' },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete batch') }, { status: safeStatus(res.status) });
    // Batch is gone. The page invalidates the payroll list cache and navigates
    // away on success (a redirect here would land on a stale cached list).
    return json({ success: true, deleted: true });
  }

  if (intent === 'approveBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.approveBatch', {
      method: 'POST', cookie,
      body: {
        batchId: formData.get('batchId')?.toString() ?? '',
        hrNotes: formData.get('hrNotes')?.toString() || undefined,
      },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to approve batch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'rejectBatch') {
    const res = await apiRequest<unknown>('/trpc/hr.rejectBatch', {
      method: 'POST', cookie,
      body: { batchId: formData.get('batchId')?.toString() ?? '', reason: formData.get('reason')?.toString() ?? '' },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to reject batch') }, { status: safeStatus(res.status) });
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
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to mark batch paid') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'generateBatch') {
    const rawMonth = formData.get('periodMonth')?.toString() ?? '';
    const periodMonth = /^\d{4}-\d{2}$/.test(rawMonth) ? `${rawMonth}-01` : rawMonth;
    // Only forward branch/department/scope when the client actually set them.
    // Null-scope batches (org-wide ALL, CONTRACTORS) carry no branch or department;
    // sending empty strings would fail the server's uuid/enum validation.
    const branchId = formData.get('branchId')?.toString() || undefined;
    const department = formData.get('department')?.toString() || undefined;
    const scopeType = formData.get('scopeType')?.toString() || undefined;
    const res = await apiRequest<unknown>('/trpc/hr.generateBatch', {
      method: 'POST', cookie,
      body: {
        periodMonth,
        ...(scopeType ? { scopeType } : {}),
        ...(branchId ? { branchId } : {}),
        ...(department ? { department } : {}),
      },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to re-generate batch') }, { status: safeStatus(res.status) });
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
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to add adjustment') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollBatchDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<PayrollBatchDetailLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
        <PayrollBatchDetailPage
          detail={data.detail as BatchDetail}
          branchName={data.branchName}
          viewer={data.viewer as ViewerInfo}
        />
      )}
    </CachedAwait>
  );
}
