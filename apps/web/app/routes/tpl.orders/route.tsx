import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { LogisticsOrdersPage, type LogisticsOrderRow } from '~/features/logistics/LogisticsOrdersPage';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;

function defaultThisMonth(): { startDate: string; endDate: string } {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
  return { startDate, endDate };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
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

  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status === 'ALL' ? undefined : status,
    search: search || undefined,
    sortBy: 'preferredDeliveryDate' as const,
    sortOrder: 'asc' as const,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(effectiveLogisticsLocationId && { logisticsLocationId: effectiveLogisticsLocationId }),
  };
  const countsInput: { startDate?: string; endDate?: string; logisticsLocationId?: string } = {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;
  if (effectiveLogisticsLocationId) countsInput.logisticsLocationId = effectiveLogisticsLocationId;

  const listInputEnc = encodeURIComponent(JSON.stringify(listInput));
  const countsInputEnc = encodeURIComponent(JSON.stringify(countsInput));

  const [ordersRes, countsRes, locationsRes, ridersRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${listInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' }))}`,
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
    riders: ridersData,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    isTplManagerScoped: !!effectiveLogisticsLocationId,
    pageTitle: 'Orders' as const,
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

  return json({ success: false, error: 'Unknown action' }, { status: 400 });
}

export default function TplOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <LogisticsOrdersPage {...data} orders={data.orders as LogisticsOrderRow[]} />;
}
