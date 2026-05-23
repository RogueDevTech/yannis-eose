import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  getCurrentUser,
  requirePermissionOrRoles,
  safeStatus,
  DEFERRED_LOADER_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpPage } from '~/features/cs/FollowUpPage';
import type { FollowUpPageData } from '~/features/cs/FollowUpPage';

export const meta: MetaFunction = () => [
  { title: 'Follow Up — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  });
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  const url = new URL(request.url);

  const status = url.searchParams.get('status') || 'DELETED';
  const branchId = url.searchParams.get('branchId') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = 50;

  // Build order list input — follow-up targets closed/overdue orders
  const listInput: Record<string, unknown> = {
    page,
    limit,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  // Map follow-up status categories to actual order statuses
  if (status === 'DELETED') {
    listInput.status = 'DELETED';
  } else if (status === 'DELIVERED') {
    listInput.status = 'DELIVERED';
  } else if (status === 'REMITTED') {
    listInput.status = 'REMITTED';
  } else if (status === 'ALL_CLOSED') {
    listInput.statuses = ['DELETED', 'DELIVERED', 'REMITTED'];
  }

  if (branchId) listInput.branchId = branchId;
  if (search) listInput.search = search;

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));

  const pageData = (async (): Promise<FollowUpPageData> => {
    const [ordersRes, branchesRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/orders.list?input=${listInputStr}`,
        deferredOpt,
      ),
      apiRequest<unknown>('/trpc/branches.list', deferredOpt),
    ]);

    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: FollowUpPageData['orders']; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;

    const branches = branchesRes.ok
      ? ((branchesRes.data as { result?: { data?: Array<{ id: string; name: string; code?: string }> } })?.result?.data ?? [])
      : [];

    return {
      orders: ordersData?.orders ?? [],
      total: ordersData?.pagination?.total ?? 0,
      totalPages: ordersData?.pagination?.totalPages ?? 1,
      branches,
    };
  })();

  return defer({
    shell: { status, branchId: branchId ?? '', search: search ?? '', page },
    pageData,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  });
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'followUpReassign') {
    let orderIds: string[];
    try {
      orderIds = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
      if (!Array.isArray(orderIds)) throw new Error();
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }
    const targetBranchId = formData.get('targetBranchId')?.toString() ?? '';
    if (!targetBranchId || orderIds.length === 0) {
      return json({ error: 'Order IDs and target branch are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.followUpReassign', {
      method: 'POST',
      cookie,
      body: { orderIds, targetBranchId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reassign orders') },
        { status: safeStatus(res.status) },
      );
    }
    const data = (res.data as { result?: { data?: { succeeded: number; failed: number } } })?.result?.data;
    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FollowUpRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait<FollowUpPageData>
      resolve={pageData as Promise<FollowUpPageData>}
      fallback={
        <FollowUpPage
          orders={[]}
          total={0}
          totalPages={1}
          branches={[]}
          filters={shell}
          deferredLoading
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <FollowUpPage
          {...data}
          filters={shell}
        />
      )}
    </CachedAwait>
  );
}
