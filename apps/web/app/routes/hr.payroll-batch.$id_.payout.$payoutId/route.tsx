import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import {
  PayoutDetailSections,
  type BatchDetail,
  type BatchPayoutLine,
  type BatchAdjustment,
} from '~/features/hr/PayrollBatchDetailPage';

export const meta: MetaFunction = () => [{ title: 'Payout details — Yannis EOSE' }];

// Same viewer gate as the batch detail page — anyone who can see the batch can
// see a payout line within it. Kept in sync with hr.payroll-batch.$id.
const PAYROLL_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

// Roles that may edit/remove an adjustment (mirrors the server's HR edit window).
const ADJUSTMENT_EDITOR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
// Server allows adjustment edit/delete only while the batch is DRAFT or PENDING_HR
// (loadCorrectableAdjustment locks PENDING_FINANCE + PAID). Gate the UI to match.
const ADJUSTMENT_EDITABLE_BATCH_STATUSES = ['DRAFT', 'PENDING_HR'];

function extractError(res: { data: unknown }, fallback: string): string {
  return extractApiErrorMessage(res.data, fallback);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Not authenticated', { status: 401 });
  await requirePermissionOrRoles(request, {
    roles: PAYROLL_VIEWER_ROLES,
    permission: ['hr.read', 'payroll.batches.view'],
  });
  const cookie = getSessionCookie(request);
  const batchId = params['id'];
  const payoutId = params['payoutId'];
  if (!batchId || !payoutId) throw new Response('Batch and payout ID required', { status: 400 });

  // Reuse the batch bundle (no dedicated payout endpoint) and pick the one line
  // plus its adjustments. Same source of truth as the batch table, so numbers
  // never drift between the row and its detail page.
  // Never throw inside the deferred promise: a rejection during a client-side
  // transition can abort the navigation entirely (the click appears to do
  // nothing). Always resolve to a payload; render the "not found" EmptyState
  // when the batch or payout can't be loaded instead of killing the nav.
  const pageData = (async () => {
    const empty = {
      batchId,
      payout: null as BatchPayoutLine | null,
      adjustments: [] as BatchAdjustment[],
      periodLabel: '',
      canEditAdjustments: false,
    };
    try {
      const batchRes = await apiRequest<unknown>(
        `/trpc/hr.getBatch?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
        { method: 'GET', cookie },
      );
      if (!batchRes.ok) return empty;
      const detail = (batchRes.data as { result?: { data?: BatchDetail } })?.result?.data ?? null;
      if (!detail) return empty;

      const payout = detail.payouts.find((p) => p.id === payoutId) ?? null;
      const adjustments = detail.adjustments.filter((a) => a.payoutId === payoutId);
      const periodLabel = detail.batch.periodMonth ?? '';
      // The batch must be HR-editable AND the viewer an HR/admin editor for the
      // Adjust/Remove controls to show. The server is still the final authority
      // (it returns a clean CONFLICT if the window has since closed).
      const canEditAdjustments =
        ADJUSTMENT_EDITOR_ROLES.includes(user.role) &&
        ADJUSTMENT_EDITABLE_BATCH_STATUSES.includes(detail.batch.status);

      return {
        batchId,
        payout: payout as BatchPayoutLine | null,
        adjustments: adjustments as BatchAdjustment[],
        periodLabel,
        canEditAdjustments,
      };
    } catch {
      return empty;
    }
  })();

  return defer({ pageData });
}

/**
 * Edit / remove an individual adjustment straight from the payslip. Both
 * mutations recompute the linked payout's net server-side
 * (recomputeForAdjustment), so the reloaded page shows the updated figures.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Not authenticated', { status: 401 });
  await requirePermissionOrRoles(request, {
    roles: ADJUSTMENT_EDITOR_ROLES,
    permission: ['hr.write'],
  });
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'deleteAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.deleteAdjustment', {
      method: 'POST',
      cookie,
      body: { adjustmentId: formData.get('adjustmentId')?.toString() ?? '' },
    });
    if (!res.ok) {
      return json({ error: extractError(res, 'Failed to remove adjustment') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateAdjustment') {
    const res = await apiRequest<unknown>('/trpc/hr.updateAdjustment', {
      method: 'POST',
      cookie,
      body: {
        adjustmentId: formData.get('adjustmentId')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '',
        category: formData.get('category')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      return json({ error: extractError(res, 'Failed to update adjustment') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function PayrollPayoutDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      deferredKey="pageData"
      fallback={
        <div className="space-y-4">
          <PageHeader title="Payout details" description="Payout breakdown for this batch" />
          {/* Mirror the loaded layout: identity row, net-pay hero, two breakdown cards. */}
          <div className="card flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 rounded-full bg-app-hover animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
          <div className="card h-24 animate-pulse" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card h-44 animate-pulse" />
            <div className="card h-44 animate-pulse" />
          </div>
        </div>
      }
    >
      {(data) => (
        <div className="space-y-4">
          <PageHeader
            title={data.payout ? data.payout.staffName : 'Payout details'}
            description="Payout breakdown for this batch"
            backTo={`/hr/payroll-batch/${data.batchId}`}
          />
          {data.payout ? (
            <PayoutDetailSections
              payout={data.payout}
              adjustments={data.adjustments}
              canEditAdjustments={data.canEditAdjustments}
            />
          ) : (
            <EmptyState
              title="Payout not found"
              description="This payout is not part of the batch, or the batch was regenerated."
            />
          )}
        </div>
      )}
    </CachedAwait>
  );
}
