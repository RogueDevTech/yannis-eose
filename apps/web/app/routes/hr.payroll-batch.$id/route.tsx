import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { PayrollBatchDetailPage, type BatchDetail } from '~/features/hr/PayrollBatchDetailPage';
import type { ViewerInfo, BranchOption } from '~/features/hr/types';

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.detail?.batch
    ? `${data.detail.batch.department} Payroll — Yannis EOSE`
    : 'Payroll Batch — Yannis EOSE';
  return [{ title }];
};

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
  const branchName = branchRows.find((b) => b.id === detail.batch.branchId)?.name ?? detail.batch.branchId.slice(0, 8);

  const viewer: ViewerInfo = {
    id: user.id,
    role: user.role,
    currentBranchId: user.currentBranchId ?? null,
    prepareDepartments: (prepareData?.departments ?? []) as ViewerInfo['prepareDepartments'],
    prepareBranchIds: (prepareData?.branches ?? []).map((b) => b.id),
  };

  return json({ detail, branchName, viewer });
}

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
        financeReference: formData.get('financeReference')?.toString() ?? '',
        disbursementDate: formData.get('disbursementDate')?.toString() || undefined,
        proofOfPaymentUrl: formData.get('proofOfPaymentUrl')?.toString() || undefined,
      },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to mark batch paid') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

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
  const { detail, branchName, viewer } = useLoaderData<typeof loader>();
  return (
    <PayrollBatchDetailPage
      detail={detail as BatchDetail}
      branchName={branchName}
      viewer={viewer as ViewerInfo}
    />
  );
}
