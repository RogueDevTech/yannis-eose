import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
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
} from '~/lib/api.server';
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
  const pageData = (async () => {
    const batchRes = await apiRequest<unknown>(
      `/trpc/hr.getBatch?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
      { method: 'GET', cookie },
    );
    if (!batchRes.ok) throw new Response('Batch not found', { status: 404 });
    const detail = (batchRes.data as { result?: { data?: BatchDetail } })?.result?.data ?? null;
    if (!detail) throw new Response('Batch not found', { status: 404 });

    const payout = detail.payouts.find((p) => p.id === payoutId) ?? null;
    const adjustments = detail.adjustments.filter((a) => a.payoutId === payoutId);
    const periodLabel = detail.batch.periodMonth ?? '';

    return {
      batchId,
      payout: payout as BatchPayoutLine | null,
      adjustments: adjustments as BatchAdjustment[],
      periodLabel,
    };
  })();

  return defer({ pageData });
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card h-48 animate-pulse" />
            <div className="card h-48 animate-pulse" />
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
            <PayoutDetailSections payout={data.payout} adjustments={data.adjustments} />
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
