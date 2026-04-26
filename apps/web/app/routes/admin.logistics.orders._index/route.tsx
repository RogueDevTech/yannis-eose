import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { LogisticsOrdersPage } from '~/features/logistics/LogisticsOrdersPage';
import type { Order } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Logistics Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;

const defaultThisMonth = defaultThisMonthRange;

export interface LogisticsOrder extends Order {
  logisticsLocationId?: string | null;
  riderId?: string | null;
  preferredDeliveryDate?: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);

  const isTplManager = user.role === 'TPL_MANAGER';
  const effectiveLogisticsLocationId =
    isTplManager && user.logisticsLocationId ? user.logisticsLocationId : undefined;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || 'ALL';
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

  // Daily-counts series for the chart-view trend line. Mirrors the same scope filters the
  // table uses (date range + 3PL location) so the trend matches what the user is reading.
  const trendInput: { logisticsLocationId?: string; status?: string; startDate?: string; endDate?: string } = {};
  if (effectiveLogisticsLocationId) trendInput.logisticsLocationId = effectiveLogisticsLocationId;
  if (status) trendInput.status = status;
  if (startDate) trendInput.startDate = startDate;
  if (endDate) trendInput.endDate = endDate;
  const trendInputEnc = encodeURIComponent(JSON.stringify(trendInput));

  const [ordersRes, countsRes, locationsRes, ridersRes, trendRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${listInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20, status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/logistics.listRiders?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.timeSeriesByCreated?input=${trendInputEnc}`, { method: 'GET', cookie }),
  ]);

  const dailyCounts = trendRes.ok
    ? ((trendRes.data as { result?: { data?: Array<{ date: string; orderCount: number }> } })?.result?.data ?? [])
    : [];

  const ordersData = ordersRes.ok
    ? (ordersRes.data as { result?: { data?: { orders: LogisticsOrder[]; pagination: { total: number; totalPages: number } } } })
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

  const enrichedOrders: Array<LogisticsOrder & { locationName: string; riderName: string }> = orders.map((o) => ({
    ...o,
    locationName: o.logisticsLocationId ? locationNameById.get(o.logisticsLocationId) ?? '—' : '—',
    riderName: o.riderId ? riderById.get(o.riderId)?.name ?? '—' : '—',
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
    dailyCounts,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    isTplManagerScoped: !!effectiveLogisticsLocationId,
    canEditDeliveryDate: false,
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

  if (intent === 'bulkAllocate') {
    await requirePermission(request, 'orders.bulkTransition');
    const orderIds = JSON.parse((formData.get('orderIds') as string) ?? '[]') as string[];
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString();
    if (!orderIds.length || !logisticsLocationId) {
      return json({ success: false, error: 'Select at least one order and a logistics location' }, { status: 400 });
    }
    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkTransition',
      {
        method: 'POST',
        cookie,
        body: {
          orderIds,
          newStatus: 'ALLOCATED',
          metadata: { logisticsLocationId },
        },
      },
    );
    if (!res.ok) {
      return json({ success: false, error: 'Bulk allocation failed', succeeded: 0, failed: orderIds.length, results: [] }, { status: safeStatus(res.status) });
    }
    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  if (intent === 'transition') {
    await requirePermission(request, 'logistics.read');
    const orderId = formData.get('orderId')?.toString();
    const newStatus = formData.get('newStatus')?.toString()?.trim();
    if (!orderId || !newStatus) {
      return json({ success: false, error: 'Order and status are required' }, { status: 400 });
    }
    const metadata: Record<string, unknown> = {};
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    if (deliveryFeeAddOnStr !== undefined && deliveryFeeAddOnStr !== '') {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata.deliveryFeeAddOn = addOn;
    }
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) metadata.deliveryDiscountAmount = discount;
    }
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Transition failed';
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
    await requirePermission(request, 'orders.bulkTransition');
    const orderIds = JSON.parse((formData.get('orderIds') as string) ?? '[]') as string[];
    const riderId = formData.get('riderId')?.toString();
    if (!orderIds.length || !riderId) {
      return json({ success: false, error: 'Select at least one order and a rider' }, { status: 400 });
    }
    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkTransition',
      {
        method: 'POST',
        cookie,
        body: {
          orderIds,
          newStatus: 'DISPATCHED',
          metadata: { riderId },
        },
      },
    );
    if (!res.ok) {
      return json({ success: false, error: 'Bulk dispatch failed', succeeded: 0, failed: orderIds.length, results: [] }, { status: safeStatus(res.status) });
    }
    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  return json({ success: false, error: 'Unknown action' }, { status: 400 });
}

export default function LogisticsOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <LogisticsOrdersPage {...data} />;
}
