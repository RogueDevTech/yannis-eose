import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpBatchDetailPage } from '~/features/cs/FollowUpBatchDetailPage';
import type { FollowUpBatchDetailData } from '~/features/cs/FollowUpBatchDetailPage';

export const meta: MetaFunction = () => [{ title: 'Follow Up Batch — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { permission: 'orders.followUp', roles: ['SUPER_ADMIN', 'ADMIN'] });
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
