import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
  getSessionCookie,
  parsePerPage,
  requirePermission,
  safeStatus,
  defaultThisMonthRange,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { LogisticsOrdersPage } from '~/features/logistics/LogisticsOrdersPage';
import type { Order } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Logistics Orders — Yannis EOSE' },
];

/** Default page size for the logistics orders table — historical default is 40. The user
 *  can switch via `?perPage=`. Keeps 40 in the allowed set so the default URL works. */
const LOGISTICS_PAGE_SIZE_OPTIONS = [20, 40, 50, 100, 200, 500, 1000];
const LOGISTICS_STATUS_SCOPE = [
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'REMITTED',
] as const;

const defaultToday = defaultThisMonthRange;

export interface LogisticsOrder extends Order {
  logisticsLocationId?: string | null;
  riderId?: string | null;
  preferredDeliveryDate?: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  // URL-driven page size — defaults to 40 (this page's historical default), allows
  // [20, 40, 50, 100]. The shared <Pagination> picker reads this from `?perPage=`.
  const { perPage: ORDERS_PER_PAGE } = parsePerPage(url.searchParams, {
    defaultPerPage: 50,
    allowed: LOGISTICS_PAGE_SIZE_OPTIONS,
  });

  const isTplManager = user.role === 'TPL_MANAGER';
  const effectiveLogisticsLocationId =
    isTplManager && user.logisticsLocationId ? user.logisticsLocationId : undefined;

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || 'ALL';
  const isOverdueFilter = status === 'OVERDUE';
  const search = url.searchParams.get('search') || undefined;
  const scopedStatuses = (status === 'ALL' || isOverdueFilter) ? [...LOGISTICS_STATUS_SCOPE] : undefined;

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultToday();
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
    // OVERDUE is not a real status — use scheduleKind filter instead
    status: (status === 'ALL' || isOverdueFilter) ? undefined : status,
    ...(scopedStatuses ? { statuses: scopedStatuses } : {}),
    ...(isOverdueFilter ? { scheduleKind: 'delivery_overdue' as const } : {}),
    search: search || undefined,
    sortBy: 'preferredDeliveryDate' as const,
    sortOrder: 'asc' as const,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(effectiveLogisticsLocationId && { logisticsLocationId: effectiveLogisticsLocationId }),
  };
  const countsInput: {
    startDate?: string;
    endDate?: string;
    logisticsLocationId?: string;
    statuses?: readonly string[];
  } = {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;
  if (effectiveLogisticsLocationId) countsInput.logisticsLocationId = effectiveLogisticsLocationId;
  if (scopedStatuses) countsInput.statuses = scopedStatuses;

  const listInputEnc = encodeURIComponent(JSON.stringify(listInput));
  const countsInputEnc = encodeURIComponent(JSON.stringify(countsInput));

  const logisticsOrdersShell = {
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    page,
    limit: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search ?? '',
    isTplManagerScoped: !!effectiveLogisticsLocationId,
    canEditDeliveryDate: false,
    allocationOnDetailOnly: true,
    orderDetailBasePath: '/admin/orders',
    orderDetailFrom: 'logistics' as const,
    pageDescription:
      'Confirmed and in-flight orders. Open one to allocate, dispatch, or confirm delivery.',
  };

  const pageData = (async () => {
    const ordersRes = await apiRequest<unknown>(`/trpc/orders.list?input=${listInputEnc}`, { method: 'GET', cookie });

    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: LogisticsOrder[]; pagination: { total: number; totalPages: number } } } })
          ?.result?.data
      : null;
    const listErrorMessage = !ordersRes.ok
      ? extractApiErrorMessage(ordersRes.data, 'Could not load logistics orders')
      : undefined;
    const ordersRaw = ordersData?.orders ?? [];
    const total = ordersData?.pagination?.total ?? 0;
    const totalPages = ordersData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

    const placeholderOrders: Array<LogisticsOrder & { locationName: string; locationProviderName: string | null; riderName: string }> =
      ordersRaw.map((o) => ({
        ...o,
        locationName: '—',
        locationProviderName: null,
        riderName: '—',
      }));

    let statusCounts: Record<string, number> = {};
    let locations: Location[] = [];
    try {
      const overdueCountInput = {
        page: 1,
        limit: 1,
        scheduleKind: 'delivery_overdue' as const,
        ...(scopedStatuses ? { statuses: scopedStatuses } : {}),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(effectiveLogisticsLocationId && { logisticsLocationId: effectiveLogisticsLocationId }),
      };
      const [countsRes, locationsRes, overdueRes] = await Promise.all([
        apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputEnc}`, { method: 'GET', cookie }),
        apiRequest<unknown>(
          `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 200, status: 'ACTIVE' }))}`,
          { method: 'GET', cookie },
        ),
        apiRequest<unknown>(
          `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(overdueCountInput))}`,
          { method: 'GET', cookie },
        ),
      ]);
      statusCounts = countsRes.ok
        ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
        : {};
      const locationsData = locationsRes.ok
        ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
        : null;
      locations = locationsData?.locations ?? [];
      const overdueData = overdueRes.ok
        ? (overdueRes.data as { result?: { data?: { pagination?: { total?: number } } } })?.result?.data
        : null;
      statusCounts['__OVERDUE'] = overdueData?.pagination?.total ?? 0;
    } catch {
      statusCounts = {};
      locations = [];
    }

    return {
      orders: placeholderOrders,
      total,
      totalPages,
      page: logisticsOrdersShell.page,
      limit: logisticsOrdersShell.limit,
      statusFilter: logisticsOrdersShell.statusFilter,
      searchFilter: logisticsOrdersShell.searchFilter,
      listErrorMessage,
      statusCounts,
      locations,
      riders: [] as Array<{ id: string; name: string; logisticsLocationId: string | null }>,
      dailyCounts: undefined,
      filters: logisticsOrdersShell.filters,
      isTplManagerScoped: logisticsOrdersShell.isTplManagerScoped,
      canEditDeliveryDate: logisticsOrdersShell.canEditDeliveryDate,
      allocationOnDetailOnly: logisticsOrdersShell.allocationOnDetailOnly,
      orderDetailBasePath: logisticsOrdersShell.orderDetailBasePath,
      orderDetailFrom: logisticsOrdersShell.orderDetailFrom,
      pageDescription: logisticsOrdersShell.pageDescription,
    };
  })();

  return defer({ logisticsOrdersShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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
        newStatus: 'AGENT_ASSIGNED',
        metadata: { logisticsLocationId },
      },
    });
    if (!res.ok) {
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Allocation failed') }, { status: safeStatus(res.status) });
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
          newStatus: 'AGENT_ASSIGNED',
          metadata: { logisticsLocationId },
        },
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      },
    );
    if (!res.ok) {
      return json(
        {
          success: false,
          error: extractApiErrorMessage(res.data, 'Bulk allocation failed'),
          succeeded: 0,
          failed: orderIds.length,
          results: [],
        },
        { status: safeStatus(res.status) },
      );
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
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Transition failed') }, { status: safeStatus(res.status) });
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
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Dispatch failed') }, { status: safeStatus(res.status) });
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
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      },
    );
    if (!res.ok) {
      return json(
        {
          success: false,
          error: extractApiErrorMessage(res.data, 'Bulk dispatch failed'),
          succeeded: 0,
          failed: orderIds.length,
          results: [],
        },
        { status: safeStatus(res.status) },
      );
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
  const { logisticsOrdersShell, pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <LogisticsOrdersPage
          deferredLoading
          orders={[]}
          total={0}
          totalPages={1}
          listErrorMessage={undefined}
          statusCounts={{}}
          locations={[]}
          riders={[]}
          page={logisticsOrdersShell.page}
          limit={logisticsOrdersShell.limit}
          statusFilter={logisticsOrdersShell.statusFilter}
          searchFilter={logisticsOrdersShell.searchFilter}
          filters={logisticsOrdersShell.filters}
          isTplManagerScoped={logisticsOrdersShell.isTplManagerScoped}
          canEditDeliveryDate={logisticsOrdersShell.canEditDeliveryDate}
          allocationOnDetailOnly={logisticsOrdersShell.allocationOnDetailOnly}
          orderDetailBasePath={logisticsOrdersShell.orderDetailBasePath}
          orderDetailFrom={logisticsOrdersShell.orderDetailFrom}
          pageDescription={logisticsOrdersShell.pageDescription}
        />
      }
      loaderShell={{ logisticsOrdersShell }}
      deferredKey="pageData"
    >
      {(data) => <LogisticsOrdersPage {...data} />}
    </CachedAwait>
  );
}
