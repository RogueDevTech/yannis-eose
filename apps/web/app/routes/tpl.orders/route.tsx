import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { LogisticsOrdersPage, type LogisticsOrderRow } from '~/features/logistics/LogisticsOrdersPage';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;

const defaultThisMonth = defaultThisMonthRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN'], permission: 'logistics.read' });
  const cookie = getSessionCookie(request);

  const isTplManager = user.role === 'TPL_MANAGER';
  const effectiveLogisticsLocationId =
    isTplManager && user.logisticsLocationId ? user.logisticsLocationId : undefined;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || 'CONFIRMED';
  const search = url.searchParams.get('search') || undefined;

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultThisMonth();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  // TPL_MANAGER: when viewing CONFIRMED, omit location so we see unallocated CONFIRMED orders to allocate to our location
  const useLocationFilter =
    effectiveLogisticsLocationId && !(isTplManager && status === 'CONFIRMED');
  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status === 'ALL' ? undefined : status,
    search: search || undefined,
    sortBy: 'preferredDeliveryDate' as const,
    sortOrder: 'asc' as const,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(useLocationFilter && { logisticsLocationId: effectiveLogisticsLocationId }),
  };
  const countsInput: { startDate?: string; endDate?: string; logisticsLocationId?: string } = {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;
  if (useLocationFilter) countsInput.logisticsLocationId = effectiveLogisticsLocationId;

  const listInputEnc = encodeURIComponent(JSON.stringify(listInput));
  const countsInputEnc = encodeURIComponent(JSON.stringify(countsInput));

  const [ordersRes, countsRes, locationsRes, ridersRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${listInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20, status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/logistics.listRiders?input=%7B%7D', { method: 'GET', cookie }),
  ]);

  const ordersData = ordersRes.ok
    ? (ordersRes.data as { result?: { data?: { orders: Array<Record<string, unknown>>; pagination: { total: number; totalPages: number } } } })
        ?.result?.data
    : null;
  const countsData = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};
  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
    : null;
  const ridersData = ridersRes.ok
    ? (ridersRes.data as { result?: { data?: Array<{ id: string; name: string; logisticsLocationId: string | null }> } })
        ?.result?.data ?? []
    : [];

  const orders = ordersData?.orders ?? [];
  const total = ordersData?.pagination?.total ?? 0;
  const totalPages = ordersData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);
  const locations = locationsData?.locations ?? [];

  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));
  const riderById = new Map(ridersData.map((r) => [r.id, r]));

  const enrichedOrders = orders.map((o: Record<string, unknown>) => ({
    ...o,
    locationName: o.logisticsLocationId ? locationNameById.get(o.logisticsLocationId as string) ?? '—' : '—',
    riderName: o.riderId ? riderById.get(o.riderId as string)?.name ?? '—' : '—',
  }));

  // TPL: only their location can be selected for allocate; admin uses all locations
  const allocatableLocations =
    effectiveLogisticsLocationId
      ? locations.filter((l) => l.id === effectiveLogisticsLocationId)
      : locations.filter((l) => !l.dispatchLocked);

  return {
    orders: enrichedOrders,
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusCounts: countsData,
    statusFilter: status,
    searchFilter: search ?? '',
    locations,
    allocatableLocations,
    riders: ridersData,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    isTplManagerScoped: !!effectiveLogisticsLocationId,
    pageTitle: 'Orders' as const,
    orderDetailBasePath: '/tpl/orders',
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'allocate') {
    await requirePermission(request, 'logistics.read');
    const orderId = formData.get('orderId')?.toString();
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString();
    if (!orderId || !logisticsLocationId) {
      return json({ success: false, error: 'Order and logistics location are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus: 'ALLOCATED',
        metadata: { logisticsLocationId },
      },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Allocation failed';
      return json({ success: false, error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dispatch') {
    await requirePermission(request, 'logistics.read');
    const orderId = formData.get('orderId')?.toString();
    const riderId = formData.get('riderId')?.toString();
    if (!orderId || !riderId) {
      return json({ success: false, error: 'Order and rider are required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus: 'DISPATCHED',
        metadata: { riderId },
      },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Dispatch failed';
      return json({ success: false, error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'bulkDispatch') {
    await requirePermission(request, 'logistics.read');
    let orderIds: string[] = [];
    try {
      const raw = formData.get('orderIds')?.toString();
      if (raw) orderIds = JSON.parse(raw) as string[];
    } catch {
      return json({ success: false, error: 'Invalid order IDs', succeeded: 0, failed: 0, results: [] }, { status: 400 });
    }
    const riderId = formData.get('riderId')?.toString();
    if (!orderIds.length || !riderId) {
      return json({ success: false, error: 'Select at least one order and a rider', succeeded: 0, failed: orderIds.length, results: [] }, { status: 400 });
    }
    const results: Array<{ orderId: string; success: boolean; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;
    for (const orderId of orderIds) {
      const res = await apiRequest<unknown>('/trpc/orders.transition', {
        method: 'POST',
        cookie,
        body: { orderId, newStatus: 'DISPATCHED', metadata: { riderId } },
      });
      if (res.ok) {
        succeeded++;
        results.push({ orderId, success: true });
      } else {
        failed++;
        const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Dispatch failed';
        results.push({ orderId, success: false, error: err });
      }
    }
    return json({ success: true, succeeded, failed, results });
  }

  return json({ success: false, error: 'Unknown action' }, { status: 400 });
}

export default function TplOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <LogisticsOrdersPage {...data} orders={data.orders as LogisticsOrderRow[]} />;
}
