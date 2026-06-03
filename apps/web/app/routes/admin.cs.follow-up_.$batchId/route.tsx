import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, safeStatus, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpBatchDetailPage } from '~/features/cs/FollowUpBatchDetailPage';
import type { FollowUpBatchDetailData } from '~/features/cs/FollowUpBatchDetailPage';

export const meta: MetaFunction = () => [{ title: 'Follow Up Batch — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'] });
  const cookie = getSessionCookie(request);
  const batchId = params.batchId!;

  const pageData = (async (): Promise<FollowUpBatchDetailData | null> => {
    const res = await apiRequest<unknown>(
      `/trpc/orders.getFollowUpBatchDetail?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    if (!res.ok) return null;
    return (res.data as { result?: { data?: FollowUpBatchDetailData } })?.result?.data ?? null;
  })();

  return defer({ batchId, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FollowUpBatchDetailRoute() {
  const { batchId, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait<FollowUpBatchDetailData | null>
      resolve={pageData as Promise<FollowUpBatchDetailData | null>}
      fallback={<FollowUpBatchDetailPage data={null} deferredLoading />}
      loaderShell={{ batchId }}
      deferredKey="pageData"
    >
      {(data) => <FollowUpBatchDetailPage data={data} />}
    </CachedAwait>
  );
}
