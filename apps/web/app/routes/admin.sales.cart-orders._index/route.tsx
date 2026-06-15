import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  DEFERRED_LOADER_TIMEOUT_MS,
  safeStatus,
  defaultThisMonthRange,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { OrdersListPage } from '~/features/orders/OrdersListPage';
import { FollowUpOrdersLoadingShell } from '~/features/cs/CSDeferredLoadingShells';
import type { Order } from '~/features/orders/types';

export const meta: MetaFunction = () => [
  { title: 'Cart Orders — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'orders.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const perPage = Math.min(Math.max(parseInt(url.searchParams.get('perPage') || '50', 10), 10), 100);
  const statusParam = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const csCloserId = url.searchParams.get('csCloserId') || undefined;
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') || 'desc';
  const branchId = url.searchParams.get('branchId') || undefined;

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultThisMonthRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const isCSCloser = user.role === 'CS_CLOSER';
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT';
  const isHoCS = user.role === 'HEAD_OF_CS';
  const assignedCsId = isCSCloser ? user.id : csCloserId;

  const userPerms = (user.permissions ?? []).map((p: string) => p);
  const canBulkPick =
    isAdmin ||
    (userPerms.includes('orders.bulkAssign') && userPerms.includes('orders.reassign'));

  const isDeletedFilter = statusParam === 'DELETED';
  const listInput: Record<string, unknown> = { page, limit: perPage, sortBy, sortOrder };
  if (isDeletedFilter) {
    listInput.showDeleted = true;
  } else if (statusParam) {
    listInput.status = statusParam;
  }
  if (search) listInput.search = search;
  if (assignedCsId) listInput.assignedCsId = assignedCsId;
  if (startDate) listInput.startDate = startDate;
  if (endDate) listInput.endDate = endDate;
  if (branchId) listInput.branchId = branchId;
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const shell = {
    view: 'cart-orders' as const,
    status: statusParam ?? '',
    search: search ?? '',
    csCloserId: csCloserId ?? '',
    page,
    perPage,
    sortBy,
    sortOrder,
    isCloser: isCSCloser,
    isAdmin,
    userRole: user.role,
    userId: user.id,
    branchId: branchId ?? '',
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
    canBulkPick,
    bulkSelectAllMatchingInput: JSON.stringify(listInput),
  };

  const pageData = (async () => {
    try {
      const [ordersRes, countsRes, closersRes, branchesRes] = await Promise.all([
        apiRequest<unknown>(`/trpc/cartOrders.list?input=${listInputStr}`, deferredOpt),
        apiRequest<unknown>(
          `/trpc/cartOrders.getStatusCounts?input=${encodeURIComponent(JSON.stringify({
            ...(branchId ? { branchId } : {}),
            ...(assignedCsId ? { assignedCsId } : {}),
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
          }))}`,
          deferredOpt,
        ).catch(() => ({ ok: false as const, status: 500, data: null })),
        apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches?input=%7B%7D', deferredOpt).catch(() => ({ ok: false as const, status: 500, data: null })),
        (isAdmin || isHoCS)
          ? apiRequest<{ result?: { data?: Array<{ id: string; name: string }> } }>('/trpc/branches.list', { method: 'GET', cookie }).catch(() => ({ ok: false as const, status: 500, data: null }))
          : Promise.resolve({ ok: true as const, status: 200, data: null }),
      ]);

      type ListResult = { orders: Array<Record<string, unknown>>; total: number; totalPages: number };
      const ordersRaw = (ordersRes.ok
        ? (ordersRes.data as { result?: { data?: ListResult } })?.result?.data
        : null) as ListResult | null;
      const countsData = (countsRes.ok ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data : null) ?? {};
      type CloserItem = { agentId: string; agentName: string };
      const closersData = (closersRes.ok ? (closersRes.data as { result?: { data?: CloserItem[] } })?.result?.data : null) ?? [];
      type BranchItem = { id: string; name: string };
      const branchesData: BranchItem[] = (branchesRes as { ok: boolean; data?: { result?: { data?: BranchItem[] } } }).ok
        ? ((branchesRes as { data?: { result?: { data?: BranchItem[] } } }).data?.result?.data ?? [])
        : [];
      // Map cart orders to the Order type used by OrdersListPage
      const orders: Order[] = (ordersRaw?.orders ?? []).map((o) => ({
        id: o.id as string,
        orderNumber: o.orderNumber as number | null,
        customerName: o.customerName as string,
        customerPhoneDisplay: '',
        status: o.status as string,
        totalAmount: (o.totalAmount as string) ?? null,
        createdAt: o.createdAt as string,
        preferredDeliveryDate: (o.preferredDeliveryDate as string) ?? null,
        callbackScheduledAt: (o.callbackScheduledAt as string) ?? null,
        assignedCsId: (o.assignedCsId as string) ?? null,
        assignedCsName: (o.assignedCsName as string) ?? null,
        mediaBuyerId: (o.mediaBuyerId as string) ?? null,
        mediaBuyerName: (o.mediaBuyerName as string) ?? null,
        primaryProductName: ((o.orderItems as Array<{ productName?: string }>)?.[0]?.productName) ?? null,
        itemCount: (o.orderItems as unknown[])?.length ?? 0,
        campaignId: (o.campaignId as string) ?? null,
        campaignName: (o.campaignName as string) ?? null,
        cartId: (o.sourceCartId as string) ?? null,
        isDuplicate: null,
        lastCsComment: null,
      }));

      return {
        orders,
        total: ordersRaw?.total ?? 0,
        totalPages: ordersRaw?.totalPages ?? 1,
        statusCounts: countsData,
        csClosersForFilter: closersData,
        branchesForMove: branchesData,
      };
    } catch {
      return {
        orders: [] as Order[],
        total: 0,
        totalPages: 1,
        statusCounts: {} as Record<string, number>,
        csClosersForFilter: [] as Array<{ agentId: string; agentName: string }>,
        branchesForMove: [] as Array<{ id: string; name: string }>,
      };
    }
  })();

  return defer({
    shell,
    pageData,
  } as Record<string, unknown>);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'bulkAssign') {
    await requirePermission(request, 'orders.bulkAssign');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const csCloserIdsRaw = form.get('csCloserIds')?.toString();
    const csCloserIdSingle = (form.get('csCloserId') as string | null) ?? '';
    let csCloserIds: string[] = [];
    if (csCloserIdsRaw) {
      try { csCloserIds = JSON.parse(csCloserIdsRaw) as string[]; } catch { /* ignore */ }
    }
    if (csCloserIds.length === 0 && csCloserIdSingle) csCloserIds = [csCloserIdSingle];
    if (csCloserIds.length === 0) {
      return json({ success: false, error: 'Pick at least one closer', succeeded: 0, failed: orderIds.length, results: [] }, { status: 400 });
    }

    const res = await apiRequest<{ result?: { data?: { success: boolean; assigned: number } } }>(
      '/trpc/cartOrders.bulkAssign',
      {
        method: 'POST',
        cookie,
        body: { orderIds, closerIds: csCloserIds },
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      },
    );

    if (!res.ok) {
      return json({
        success: false,
        error: extractApiErrorMessage(res.data, 'Bulk assign failed'),
        succeeded: 0,
        failed: orderIds.length,
        results: [],
      });
    }
    const data = res.data?.result?.data;
    return json({ success: true, succeeded: data?.assigned ?? 0, failed: 0, results: [] });
  }

  if (intent === 'bulkTransition') {
    await requirePermission(request, 'orders.write');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const newStatus = form.get('newStatus') as string;
    const reason = form.get('reason')?.toString() || undefined;

    // Transition each cart order individually
    let succeeded = 0;
    let failed = 0;
    const results: Array<{ orderId: string; success: boolean; error?: string }> = [];
    for (const orderId of orderIds) {
      const res = await apiRequest<{ result?: { data?: { success: boolean } } }>(
        '/trpc/cartOrders.transition',
        {
          method: 'POST',
          cookie,
          body: { orderId, newStatus, note: reason },
          timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
        },
      );
      if (res.ok && res.data?.result?.data?.success) {
        succeeded++;
        results.push({ orderId, success: true });
      } else {
        failed++;
        results.push({ orderId, success: false, error: extractApiErrorMessage(res.data, 'Failed') });
      }
    }
    return json({ success: true, succeeded, failed, results });
  }

  if (intent === 'assignToCS') {
    await requirePermission(request, 'orders.reassign');
    const orderId = form.get('orderId') as string;
    const closerId = form.get('closerId') as string;
    const res = await apiRequest<{ result?: { data?: { success: boolean } } }>(
      '/trpc/cartOrders.assignToCS',
      { method: 'POST', cookie, body: { orderId, closerId } },
    );
    if (!res.ok) {
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Assign failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ success: false, error: 'Unknown intent' }, { status: 400 });
}

type CartOrdersBundle = {
  orders: Order[];
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  csClosersForFilter: Array<{ agentId: string; agentName: string }>;
  branchesForMove: Array<{ id: string; name: string }>;
};

export default function CartOrdersRoute() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaderData = useLoaderData<typeof loader>() as any;
  const shell = loaderData.shell;

  const baseShellProps = {
    page: shell?.page ?? 1,
    limit: shell?.perPage ?? 50,
    statusFilter: shell?.status ?? '',
    searchFilter: shell?.search ?? '',
    sortBy: shell?.sortBy ?? 'createdAt',
    sortOrder: shell?.sortOrder ?? 'desc',
    isCSCloser: shell?.isCloser ?? false,
    showCSCloserColumn: !shell?.isCloser,
    userRole: shell?.userRole ?? '',
    currentUserId: shell?.userId ?? '',
    canBulkPick: shell?.canBulkPick ?? false,
    canAssignDirectly: !shell?.isCloser,
    orderDetailFrom: 'cart-orders' as const,
    detailBasePath: '/admin/orders',
    hideOfflineAndCartStats: true,
    filters: {
      startDate: shell?.startDate ?? '',
      endDate: shell?.endDate ?? '',
      periodAllTime: shell?.periodAllTime ?? false,
    },
  };

  return (
    <CachedAwait<CartOrdersBundle>
      resolve={loaderData.pageData as Promise<CartOrdersBundle>}
      fallback={
        <FollowUpOrdersLoadingShell
          pageTitle="Cart Orders"
          pageDescription="Orders recovered from abandoned carts."
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <OrdersListPage
          orders={data.orders ?? []}
          total={data.total ?? 0}
          totalPages={data.totalPages ?? 1}
          statusCounts={data.statusCounts ?? {}}
          csClosersForFilter={data.csClosersForFilter ?? []}
          branchesForMove={data.branchesForMove ?? []}
          myWorkload={null}
          excludeStatuses={['REMITTED']}
          pageTitle="Cart Orders"
          pageDescription="Orders recovered from abandoned carts."
          bulkSelectAllMatchingInput={shell?.bulkSelectAllMatchingInput}
          bulkSelectEndpoint="cartOrders.list"
          bulkMovePerItem
          {...baseShellProps}
        />
      )}
    </CachedAwait>
  );
}

export function ErrorBoundary() {
  return (
    <div className="p-6 text-center">
      <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Failed to load cart orders</h2>
      <p className="mt-2 text-sm text-muted-foreground">Please try refreshing the page.</p>
    </div>
  );
}
