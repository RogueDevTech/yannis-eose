import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange, safeStatus } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { OrdersListPage } from '~/features/orders/OrdersListPage';
import type { Order } from '~/features/orders/types';
import type { ListOrdersScheduleKind } from '@yannis/shared';
import type { ScheduleHeatDay } from '~/components/ui/schedule-heat-calendar';
import { CS_ORDERS_STATUS_DROPDOWN_EXCLUDE } from '~/features/shared/order-status';
import { ListFilterPersistence } from '~/components/list-filter-persistence';
import { ALLOWLIST_CS_ORDERS, LIST_FILTER_SCOPES } from '~/lib/list-filter-persistence-scopes';

export const meta: MetaFunction = () => [
  { title: 'CS Orders — Yannis EOSE' },
];

const CS_ORDERS_LIVE_EVENTS = [
  'order:new',
  'order:status_changed',
  'order:assigned',
  'order:transfer_requested',
  'order:transfer_accepted',
  'order:transfer_rejected',
] as const;

const ORDERS_PER_PAGE = 40;

const defaultThisMonth = defaultThisMonthRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'orders.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  let status = url.searchParams.get('status') || undefined;
  if (status && CS_ORDERS_STATUS_DROPDOWN_EXCLUDE.has(status)) {
    url.searchParams.delete('status');
    const qs = url.searchParams.toString();
    throw redirect(qs ? `${url.pathname}?${qs}` : url.pathname);
  }
  const search = url.searchParams.get('search') || undefined;
  const csAgentIdParam = url.searchParams.get('csAgentId') || undefined;

  const scheduleKindRaw = url.searchParams.get('scheduleKind') || undefined;
  const scheduleDateRaw = url.searchParams.get('scheduleDate') || undefined;
  const calendarMonthRaw = url.searchParams.get('calendarMonth') || undefined;

  let scheduleKind: ListOrdersScheduleKind | undefined;
  if (
    scheduleKindRaw === 'callback_due' ||
    scheduleKindRaw === 'callback_on_day' ||
    scheduleKindRaw === 'delivery_on_day' ||
    scheduleKindRaw === 'delivery_overdue'
  ) {
    scheduleKind = scheduleKindRaw as ListOrdersScheduleKind;
  }
  const scheduleDate =
    scheduleDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDateRaw) ? scheduleDateRaw : undefined;
  if (scheduleKind === 'callback_on_day' || scheduleKind === 'delivery_on_day') {
    if (!scheduleDate) scheduleKind = undefined;
  }

  const now = new Date();
  const defaultCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let calendarMonth =
    calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : defaultCalendarMonth;
  if (scheduleDate && !calendarMonthRaw) {
    calendarMonth = scheduleDate.slice(0, 7);
  }

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

  const isCSAgent = user.role === 'CS_AGENT';
  const assignedCsId = isCSAgent ? user.id : csAgentIdParam;
  // Phase 21 — capability gate now permission-driven so a custom role with
  // `orders.createOffline` can show the offline-entry button without inheriting CS_AGENT.
  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canCreateOffline =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'CS_AGENT' ||
    userPerms.includes(canonicalPermissionCode('orders.createOffline'));

  const listInput: Record<string, unknown> = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status || undefined,
    search: search || undefined,
    ...(assignedCsId && { assignedCsId }),
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };
  if (scheduleKind === 'callback_due') {
    listInput.scheduleKind = 'callback_due';
  } else if (scheduleKind === 'delivery_overdue') {
    listInput.scheduleKind = 'delivery_overdue';
  } else if (scheduleKind === 'delivery_on_day' && scheduleDate) {
    listInput.scheduleKind = 'delivery_on_day';
    listInput.scheduleDate = scheduleDate;
  } else if (scheduleKind === 'callback_on_day' && scheduleDate) {
    listInput.scheduleKind = 'callback_on_day';
    listInput.scheduleDate = scheduleDate;
  }
  const countsInput: { assignedCsId?: string; startDate?: string; endDate?: string } = assignedCsId ? { assignedCsId } : {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;

  const input = encodeURIComponent(JSON.stringify(listInput));
  const countsInputEnc = encodeURIComponent(JSON.stringify(countsInput));

  // Daily-counts series for the chart-view trend line. Mirrors the same scope filters the
  // table uses so the trend matches what the user is reading.
  const trendInput: { assignedCsId?: string; status?: string; startDate?: string; endDate?: string } = {};
  if (assignedCsId) trendInput.assignedCsId = assignedCsId;
  if (status) trendInput.status = status;
  if (startDate) trendInput.startDate = startDate;
  if (endDate) trendInput.endDate = endDate;
  const trendInputEnc = encodeURIComponent(JSON.stringify(trendInput));

  const heatInput = {
    yearMonth: calendarMonth,
    ...(assignedCsId && { assignedCsId }),
    ...(status && { status }),
  };
  const heatInputEnc = encodeURIComponent(JSON.stringify(heatInput));

  const [res, countsRes, myWorkloadRes, trendRes, heatRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${input}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputEnc}`, { method: 'GET', cookie }),
    isCSAgent ? apiRequest<unknown>('/trpc/orders.myCSWorkload', { method: 'GET', cookie }) : Promise.resolve(null),
    apiRequest<unknown>(`/trpc/orders.timeSeriesByCreated?input=${trendInputEnc}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.scheduleCalendarHeat?input=${heatInputEnc}`, { method: 'GET', cookie }),
  ]);

  const dailyCounts = trendRes.ok
    ? ((trendRes.data as {
        result?: { data?: Array<{ date: string; orderCount: number; deliveredCount?: number }> };
      })?.result?.data ?? [])
    : [];

  const scheduleHeat: ScheduleHeatDay[] = heatRes.ok
    ? ((heatRes.data as { result?: { data?: ScheduleHeatDay[] } })?.result?.data ?? [])
    : [];

  const trpcData = res.ok
    ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;
  const countsData = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};
  const total = trpcData?.pagination?.total ?? 0;
  const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  const showCSAgentColumn = user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const myWorkload =
    isCSAgent && myWorkloadRes && (myWorkloadRes as { ok: boolean }).ok
      ? ((myWorkloadRes as { data?: { result?: { data?: { agentId: string; agentName: string; capacity: number; pendingCount: number; lastActionAt: string | null } } } }).data?.result?.data ??
        null)
      : null;

  let csAgentsForFilter: Array<{ agentId: string; agentName: string }> = [];
  let logisticsLocationsForBulk: Array<{ id: string; name: string; providerName: string | null }> = [];
  if (showCSAgentColumn) {
    const locationsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 100 }));
    const [workloadsRes, locationsRes] = await Promise.all([
      apiRequest<{ result?: { data?: Array<{ agentId: string; agentName: string }> } }>(
        '/trpc/orders.csWorkloads?input=%7B%7D',
        { method: 'GET', cookie },
      ),
      apiRequest<{ result?: { data?: { locations: Array<{ id: string; name: string; providerName: string | null }> } } }>(
        `/trpc/logistics.listLocations?input=${locationsInput}`,
        { method: 'GET', cookie },
      ),
    ]);
    if (workloadsRes.ok && Array.isArray(workloadsRes.data?.result?.data)) {
      csAgentsForFilter = workloadsRes.data.result.data.map((w) => ({ agentId: w.agentId, agentName: w.agentName }));
    }
    if (locationsRes.ok && Array.isArray(locationsRes.data?.result?.data?.locations)) {
      logisticsLocationsForBulk = locationsRes.data.result.data.locations.map((loc) => ({
        id: loc.id,
        name: loc.name,
        providerName: loc.providerName ?? null,
      }));
    }
  }

  let productsForOfflineOrder: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> = [];
  if (canCreateOffline) {
    const productsRes = await apiRequest<{ result?: { data?: { products: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> } } }>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    );
    if (productsRes.ok && productsRes.data?.result?.data?.products) {
      productsForOfflineOrder = productsRes.data.result.data.products;
    }
  }

  return {
    orders: trpcData?.orders ?? [],
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusCounts: countsData,
    statusFilter: status,
    searchFilter: search,
    isCSAgent,
    showCSAgentColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    myWorkload,
    csAgentsForFilter,
    logisticsLocationsForBulk,
    canCreateOffline,
    productsForOfflineOrder,
    dailyCounts,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    scheduleHeat,
    scheduleFilters: {
      calendarMonth,
      scheduleKind: scheduleKind ?? null,
      scheduleDate: scheduleKind === 'delivery_overdue' ? null : (scheduleDate ?? null),
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  const cookie = getSessionCookie(request);
  if (!cookie) {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'createOffline') {
    const createOfflineUser = await requirePermission(request, 'orders.read');
    if (!['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'].includes(createOfflineUser.role)) {
      return json({ error: 'Only closers and Head of CS can create offline orders' }, { status: 403 });
    }
    const customerName = form.get('customerName')?.toString()?.trim() ?? '';
    const customerPhone = form.get('customerPhone')?.toString()?.trim() ?? '';
    const itemsRaw = form.get('items')?.toString() ?? '[]';
    let items: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
    try {
      items = JSON.parse(itemsRaw) as Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
    } catch {
      return json({ error: 'Invalid items' }, { status: 400 });
    }
    if (!customerName || customerName.length < 2) {
      return json({ error: 'Customer name is required (min 2 characters)' }, { status: 400 });
    }
    if (!customerPhone) {
      return json({ error: 'Customer phone is required' }, { status: 400 });
    }
    if (!items.length || items.some((i) => !i.productId || i.quantity < 1 || i.unitPrice == null)) {
      return json({ error: 'At least one valid item (product, quantity, unit price) is required' }, { status: 400 });
    }
    const paymentMethod = (form.get('paymentMethod') as string) === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY';
    const customerEmail = form.get('customerEmail')?.toString()?.trim();
    if (paymentMethod === 'PAY_ONLINE' && (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
      return json({ error: 'Valid email is required for Pay online' }, { status: 400 });
    }
    const res = await apiRequest<{ result?: { data?: { id: string } } }>('/trpc/orders.createOffline', {
      method: 'POST',
      cookie,
      body: {
        customerName,
        customerPhone,
        customerAddress: form.get('customerAddress')?.toString()?.trim() || undefined,
        deliveryAddress: form.get('deliveryAddress')?.toString()?.trim() || undefined,
        deliveryNotes: form.get('deliveryNotes')?.toString()?.trim() || undefined,
        deliveryState: form.get('deliveryState')?.toString()?.trim() || undefined,
        customerGender: (form.get('customerGender') as string) || undefined,
        preferredDeliveryDate: form.get('preferredDeliveryDate')?.toString()?.trim() || undefined,
        paymentMethod,
        customerEmail: paymentMethod === 'PAY_ONLINE' ? customerEmail : undefined,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, offerLabel: i.offerLabel })),
        totalAmount: parseFloat((form.get('totalAmount') as string) || '0') || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create offline order') }, { status: safeStatus(res.status) });
    }
    const orderId = res.data?.result?.data?.id;
    return json({ success: true, orderId });
  }

  if (intent === 'bulkTransition') {
    await requirePermission(request, 'orders.bulkTransition');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const newStatus = form.get('newStatus') as string;
    const reason = form.get('reason')?.toString() || undefined;

    const body: { orderIds: string[]; newStatus: string; metadata?: Record<string, unknown> } = {
      orderIds,
      newStatus,
    };
    const metadata: Record<string, unknown> = {};
    if (reason) metadata.reason = reason;
    const logisticsLocationId = form.get('logisticsLocationId')?.toString();
    if (logisticsLocationId) metadata.logisticsLocationId = logisticsLocationId;
    if (Object.keys(metadata).length) body.metadata = metadata;

    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkTransition',
      {
        method: 'POST',
        cookie,
        body,
      },
    );

    if (!res.ok) {
      return json({ success: false, error: 'Bulk transition failed', succeeded: 0, failed: orderIds.length, results: [] });
    }

    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  if (intent === 'bulkAssign') {
    await requirePermission(request, 'orders.bulkAssign');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const csAgentId = form.get('csAgentId') as string;

    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkAssignToCS',
      {
        method: 'POST',
        cookie,
        body: { orderIds, csAgentId },
      },
    );

    if (!res.ok) {
      return json({ success: false, error: 'Bulk assign failed', succeeded: 0, failed: orderIds.length, results: [] });
    }

    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  return json({ success: false, error: 'Unknown intent' });
}

export default function CSOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/admin') as { user: { role: string } } | undefined;
  const userRole = parentData?.user?.role;
  usePageRefreshOnEvent([...CS_ORDERS_LIVE_EVENTS]);
  return (
    <>
      <ListFilterPersistence scope={LIST_FILTER_SCOPES.csOrders} allowlist={ALLOWLIST_CS_ORDERS} />
    <OrdersListPage
      {...data}
      userRole={userRole}
      liveEvents={[...CS_ORDERS_LIVE_EVENTS]}
      canCreateOffline={data.canCreateOffline}
      productsForOfflineOrder={data.productsForOfflineOrder}
    />
    </>
  );
}
