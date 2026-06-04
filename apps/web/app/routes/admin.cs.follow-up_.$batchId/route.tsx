import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, safeStatus, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpBatchDetailPage } from '~/features/cs/FollowUpBatchDetailPage';
import type { FollowUpBatchDetailData, BatchDetailBundle } from '~/features/cs/FollowUpBatchDetailPage';

export const meta: MetaFunction = () => [{ title: 'Follow Up Batch — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'] });
  const cookie = getSessionCookie(request);
  const batchId = params.batchId!;

  const pageData = (async (): Promise<BatchDetailBundle> => {
    try {
      const [detailRes, closersRes] = await Promise.all([
        apiRequest<unknown>(
          `/trpc/orders.getFollowUpBatchDetail?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
          { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
        ),
        apiRequest<unknown>('/trpc/orders.listCSClosers', {
          method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS,
        }),
      ]);
      const detail = detailRes.ok
        ? ((detailRes.data as { result?: { data?: FollowUpBatchDetailData } })?.result?.data ?? null)
        : null;
      const closers = closersRes.ok
        ? ((closersRes.data as { result?: { data?: Array<{ agentId: string; agentName: string }> } })?.result?.data ?? [])
        : [];
      return { detail, closers };
    } catch {
      return { detail: null, closers: [] };
    }
  })();

  return defer({ batchId, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'] });
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'assignBatchItem') {
    const batchItemId = formData.get('batchItemId')?.toString();
    const csCloserId = formData.get('csCloserId')?.toString();
    if (!batchItemId || !csCloserId) return json({ error: 'Missing fields' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.assignBatchItem', {
      method: 'POST', cookie, body: { batchItemId, csCloserId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'bulkAssignBatchItems') {
    let itemIds: string[];
    let csCloserIds: string[];
    try {
      itemIds = JSON.parse(formData.get('itemIds')?.toString() ?? '[]');
      csCloserIds = JSON.parse(formData.get('csCloserIds')?.toString() ?? '[]');
    } catch {
      return json({ error: 'Invalid data' }, { status: 400 });
    }
    if (itemIds.length === 0 || csCloserIds.length === 0) return json({ error: 'Select items and closers' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.bulkAssignBatchItems', {
      method: 'POST', cookie, body: { itemIds, csCloserIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'deleteBatch') {
    const batchId = formData.get('batchId')?.toString();
    if (!batchId) return json({ error: 'Missing batch ID' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.deleteFollowUpBatch', {
      method: 'POST', cookie, body: { batchId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete batch') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { reverted: number; skipped: number; skippedStatuses: string[] } } })?.result?.data;
    return json({ success: true, deleted: true, reverted: data?.reverted ?? 0, skipped: data?.skipped ?? 0 });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FollowUpBatchDetailRoute() {
  const { batchId, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait<BatchDetailBundle>
      resolve={pageData as Promise<BatchDetailBundle>}
      fallback={<FollowUpBatchDetailPage data={null} closers={[]} deferredLoading />}
      loaderShell={{ batchId }}
      deferredKey="pageData"
    >
      {(bundle) => <FollowUpBatchDetailPage data={bundle.detail} closers={bundle.closers} />}
    </CachedAwait>
  );
}
