import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermissionOrRoles, safeStatus, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpBatchDetailPage } from '~/features/cs/FollowUpBatchDetailPage';
import type { FollowUpBatchDetailData, BatchDetailBundle } from '~/features/cs/FollowUpBatchDetailPage';

export const meta: MetaFunction = () => [{ title: 'Follow Up Batch — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'] });
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);
  const batchId = params.batchId!;
  const isCloser = user?.role === 'CS_CLOSER';

  const pageData = (async (): Promise<BatchDetailBundle> => {
    try {
      const fetches: [Promise<unknown>, Promise<unknown>] = [
        apiRequest<unknown>(
          `/trpc/orders.getFollowUpBatchDetail?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
          { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
        ),
        // Closers don't need the closer list — they can't assign
        isCloser
          ? Promise.resolve({ ok: true, data: { result: { data: [] } } })
          : apiRequest<unknown>('/trpc/orders.listCSClosers', {
              method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS,
            }),
      ];
      const [detailRes, closersRes] = await Promise.all(fetches) as [{ ok: boolean; data: unknown }, { ok: boolean; data: unknown }];
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

  return defer({ batchId, isCloser, userId: user?.id, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  // Closers are read-only on batch detail — only managers can assign/delete
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'] });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaderData = useLoaderData<typeof loader>() as any;
  const { batchId, isCloser, userId } = loaderData;
  return (
    <CachedAwait<BatchDetailBundle>
      resolve={loaderData.pageData as Promise<BatchDetailBundle>}
      fallback={<FollowUpBatchDetailPage data={null} closers={[]} deferredLoading isCloser={isCloser} />}
      loaderShell={{ batchId }}
      deferredKey="pageData"
    >
      {(bundle) => <FollowUpBatchDetailPage data={bundle.detail} closers={bundle.closers} isCloser={isCloser} userId={userId} />}
    </CachedAwait>
  );
}
