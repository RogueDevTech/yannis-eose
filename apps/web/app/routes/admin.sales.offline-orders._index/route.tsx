import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  defaultThisMonthRange,
  parsePerPage,
  safeStatus,
} from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { OrdersListPage, type OrdersListPageProps } from '~/features/orders/OrdersListPage';
import { CSOrdersLoadingShell } from '~/features/cs/CSDeferredLoadingShells';
import type { Order } from '~/features/orders/types';
import type { ListOrdersScheduleKind } from '@yannis/shared';
import type { ScheduleHeatDay } from '~/components/ui/schedule-heat-calendar';
import { STATUS_OPTIONS } from '~/features/shared/order-status';

// Same status validation as the main Sales Orders route.
const CS_ORDERS_VISIBLE_STATUSES = new Set([
  ...STATUS_OPTIONS.filter((s) => s !== 'ALL' && s !== 'REMITTED'),
  'CANCELLED',
  'DELETED',
]);

export const meta: MetaFunction = () => [
  { title: 'Offline Orders — Sales — Yannis EOSE' },
];

const CS_ORDERS_LIVE_EVENTS = [
  'order:new',
  'order:status_changed',
  'order:assigned',
  'order:transfer_requested',
  'order:transfer_accepted',
  'order:transfer_rejected',
] as const;

const defaultToday = defaultThisMonthRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'orders.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage: ORDERS_PER_PAGE } = parsePerPage(url.searchParams, { defaultPerPage: 100 });
  let status = url.searchParams.get('status') || undefined;
  if (status && !CS_ORDERS_VISIBLE_STATUSES.has(status)) {
    url.searchParams.delete('status');
    const qs = url.searchParams.toString();
    throw redirect(qs ? `${url.pathname}?${qs}` : url.pathname);
  }
  const search = url.searchParams.get('search') || undefined;
  const csCloserIdParam = url.searchParams.get('csCloserId') || undefined;

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

  const now = new Date();
  const defaultCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let calendarMonth =
    calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : defaultCalendarMonth;
  if (scheduleDate && !calendarMonthRaw) {
    calendarMonth = scheduleDate.slice(0, 7);
  }

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  let startTime = url.searchParams.get('startTime') ?? undefined;
  let endTime = url.searchParams.get('endTime') ?? undefined;
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
    startTime = undefined;
    endTime = undefined;
  }
  if (!startDate) startTime = undefined;
  if (!endDate) endTime = undefined;
  const composeBound = (date: string | undefined, time: string | undefined): string | undefined => {
    if (!date) return undefined;
    if (!time) return date;
    return `${date}T${time}:00`;
  };
  const apiStartDate = composeBound(startDate, startTime);
  const apiEndDate = composeBound(endDate, endTime);

  const isCSCloser = user.role === 'CS_CLOSER';
  const assignedCsId = isCSCloser ? user.id : csCloserIdParam;
  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canCreateOffline =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPPORT' ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'CS_CLOSER' ||
    userPerms.includes(canonicalPermissionCode('orders.createOffline'));
  const canExport =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPPORT' ||
    userPerms.includes(canonicalPermissionCode('orders.export'));
  const canImportOrders = user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT';
  const canBulkPick =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPPORT' ||
    (userPerms.includes(canonicalPermissionCode('orders.bulkAssign')) &&
      userPerms.includes(canonicalPermissionCode('orders.reassign')));
  const canFreeze =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPPORT' ||
    userPerms.includes(canonicalPermissionCode('orders.freeze'));

  const hasScheduleListFilter =
    scheduleKind === 'callback_due' ||
    scheduleKind === 'delivery_overdue' ||
    (scheduleKind === 'delivery_on_day' && !!scheduleDate) ||
    (scheduleKind === 'callback_on_day' && !!scheduleDate);

  const productIdParam = url.searchParams.get('productId') || undefined;
  const frozenParam = url.searchParams.get('frozen') || undefined;
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') || 'desc';

  const expandConfirmedFilter = status === 'CONFIRMED';
  const expandDeliveredFilter = status === 'DELIVERED';
  const expandedStatuses = expandConfirmedFilter
    ? ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT']
    : expandDeliveredFilter
      ? ['DELIVERED', 'REMITTED']
      : null;

  // Always filter to offline orders — this is the defining trait of this route.
  const orderSource = 'offline' as const;

  const listInput: Record<string, unknown> = {
    page,
    limit: ORDERS_PER_PAGE,
    ...(expandedStatuses
      ? { statuses: expandedStatuses }
      : { status: status || undefined }),
    search: search || undefined,
    sortBy,
    sortOrder,
    ...(assignedCsId && { assignedCsId }),
    ...(productIdParam && { productId: productIdParam }),
    ...(frozenParam === 'frozen' || frozenParam === 'active' ? { frozenFilter: frozenParam } : {}),
    orderSource,
    ...(!hasScheduleListFilter && apiStartDate && { startDate: apiStartDate }),
    ...(!hasScheduleListFilter && apiEndDate && { endDate: apiEndDate }),
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
  const input = encodeURIComponent(JSON.stringify(listInput));

  const showCSCloserColumn = user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT';

  const csOrdersShell = {
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      startTime: startTime ?? '',
      endTime: endTime ?? '',
      periodAllTime,
    },
    scheduleFilters: {
      calendarMonth,
      scheduleKind: scheduleKind ?? null,
      scheduleDate: scheduleKind === 'delivery_overdue' ? null : (scheduleDate ?? null),
    },
    isCSCloser,
    showCSCloserColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT',
    currentUserId: user.id,
    canCreateOffline,
    canImportOrders,
    canExport,
    canBulkPick,
    canFreeze,
    page,
    limit: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search,
  };

  const pageData = (async (): Promise<
    Pick<
      OrdersListPageProps,
      | 'orders'
      | 'total'
      | 'totalPages'
      | 'page'
      | 'limit'
      | 'statusFilter'
      | 'searchFilter'
      | 'filters'
      | 'scheduleFilters'
      | 'isCSCloser'
      | 'showCSCloserColumn'
      | 'canAssignDirectly'
      | 'currentUserId'
      | 'canCreateOffline'
      | 'canImportOrders'
      | 'canExport'
      | 'canBulkPick'
      | 'canFreeze'
      | 'bulkSelectAllMatchingInput'
      | 'deferredSecondary'
      | 'branchesForMove'
      | 'enableFromCartStatusOption'
      | 'isCartAbandonmentView'
      | 'pageTitle'
      | 'pageDescription'
    > & { sortBy?: string; sortOrder?: string; productFilter?: string; frozenFilter?: string }
  > => {
  const listRes = await apiRequest<unknown>(`/trpc/orders.list?input=${input}`, { method: 'GET', cookie });
  const trpcData = listRes.ok
    ? (listRes.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;
  const orders: Order[] = trpcData?.orders ?? [];
  const total: number = trpcData?.pagination?.total ?? 0;
  const totalPages: number = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  const deferredSecondary = (async () => {
    // Use the same page bundle but with offline-scoped counts.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        countsAssignedCsId: assignedCsId,
        countsStartDate: apiStartDate,
        countsEndDate: apiEndDate,
        trendStatus: status,
        heatYearMonth: calendarMonth,
        heatStatus: status,
        isCSCloser,
        showCSCloserColumn,
        canCreateOffline,
      }),
    );
    const bundleRes = await apiRequest<unknown>(
      `/trpc/orders.csOrdersPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie },
    );

    type BundleData = {
      statusCounts: Record<string, number>;
      myWorkload: {
        agentId: string;
        agentName: string;
        capacity: number;
        pendingCount: number;
        todayClosesCount?: number;
        lastActionAt: string | null;
      } | null;
      dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
      scheduleHeat: ScheduleHeatDay[];
      csClosersForFilter: Array<{ agentId: string; agentName: string }>;
      logisticsLocationsForBulk: Array<{ id: string; name: string; providerName: string | null }>;
      productsForOfflineOrder: Array<{
        id: string;
        name: string;
        offers?: Array<{ label: string; price: string; qty: number }>;
      }>;
      offlineCount: number;
      cartAbandonmentCount: number;
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    return {
      statusCounts: bundle?.statusCounts ?? {},
      dailyCounts: bundle?.dailyCounts ?? [],
      scheduleHeat: bundle?.scheduleHeat ?? [],
      myWorkload: bundle?.myWorkload ?? null,
      csClosersForFilter: bundle?.csClosersForFilter ?? [],
      logisticsLocationsForBulk: bundle?.logisticsLocationsForBulk ?? [],
      productsForOfflineOrder: bundle?.productsForOfflineOrder ?? [],
      productsForFilter: (bundle?.productsForOfflineOrder ?? []).map((p) => ({ id: p.id, name: p.name })),
      offlineCount: bundle?.offlineCount ?? 0,
      cartAbandonmentCount: bundle?.cartAbandonmentCount ?? 0,
    };
  })();

  // Fetch branches for the "Move to branch" bulk action (Admin / HoCS only).
  const canMoveToBranch =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT' || user.role === 'HEAD_OF_CS';
  let branchesForMove: Array<{ id: string; name: string }> | undefined;
  if (canMoveToBranch) {
    const branchesRes = await apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });
    const branchesData = branchesRes.ok
      ? (branchesRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data
      : null;
    branchesForMove = (branchesData ?? []).map((b) => ({ id: b.id, name: b.name }));
  }

  return {
    orders,
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search,
    sortBy,
    sortOrder,
    isCSCloser,
    showCSCloserColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT',
    currentUserId: user.id,
    canCreateOffline,
    canImportOrders,
    canExport,
    canBulkPick,
    canFreeze,
    productFilter: productIdParam,
    frozenFilter: frozenParam,
    branchesForMove,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    scheduleFilters: {
      calendarMonth,
      scheduleKind: scheduleKind ?? null,
      scheduleDate: scheduleKind === 'delivery_overdue' ? null : (scheduleDate ?? null),
    },
    bulkSelectAllMatchingInput: JSON.stringify(listInput),
    deferredSecondary,
    enableFromCartStatusOption: false,
    isCartAbandonmentView: false,
    pageTitle: 'Offline Orders',
    pageDescription: 'Orders created manually by CS.',
  };
  })();

  return defer({
    csOrdersShell,
    pageData,
  } as Record<string, unknown>);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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
    if (!['CS_CLOSER', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(createOfflineUser.role)) {
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
        cartId: form.get('cartId')?.toString()?.trim() || undefined,
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
        ...(form.get('customFields') ? { customFields: JSON.parse(form.get('customFields') as string) } : {}),
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
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      },
    );

    if (!res.ok) {
      return json({
        success: false,
        error: extractApiErrorMessage(res.data, 'Bulk transition failed'),
        succeeded: 0,
        failed: orderIds.length,
        results: [],
      });
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
    const csCloserIdsRaw = form.get('csCloserIds')?.toString();
    const csCloserIdSingle = (form.get('csCloserId') as string | null) ?? '';

    let csCloserIds: string[] = [];
    if (csCloserIdsRaw) {
      try {
        const parsed = JSON.parse(csCloserIdsRaw) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          csCloserIds = parsed as string[];
        }
      } catch {
        return json(
          {
            success: false,
            error: 'Invalid closer selection',
            succeeded: 0,
            failed: orderIds.length,
            results: [],
          },
          { status: 400 },
        );
      }
    }
    if (csCloserIds.length === 0 && csCloserIdSingle) {
      csCloserIds = [csCloserIdSingle];
    }
    if (csCloserIds.length === 0) {
      return json(
        {
          success: false,
          error: 'Pick at least one closer',
          succeeded: 0,
          failed: orderIds.length,
          results: [],
        },
        { status: 400 },
      );
    }

    const explicitBranchId = form.get('branchId')?.toString() || undefined;
    const body: Record<string, unknown> =
      csCloserIds.length === 1
        ? { orderIds, csCloserId: csCloserIds[0] }
        : { orderIds, csCloserIds };
    if (explicitBranchId) body.branchId = explicitBranchId;

    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkAssignToCS',
      {
        method: 'POST',
        cookie,
        body,
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
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  if (intent === 'moveOrdersToBranch') {
    const orderIds = JSON.parse(form.get('orderIds')?.toString() ?? '[]');
    const targetBranchId = form.get('targetBranchId')?.toString() ?? '';
    if (!Array.isArray(orderIds) || orderIds.length === 0 || !targetBranchId) {
      return json({ error: 'Order IDs and target branch are required' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/orders.moveOrdersToBranch', {
      method: 'POST',
      cookie,
      body: { orderIds, targetBranchId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to move orders') }, { status: safeStatus(res.status) });
    }
    const data = (res.data as { result?: { data?: { succeeded: number; failed: number } } })?.result?.data;
    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  if (intent === 'bulkFreeze') {
    await requirePermission(request, 'orders.freeze');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const reason = form.get('reason')?.toString() || undefined;
    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number } } }>(
      '/trpc/orders.bulkFreezeOrders',
      { method: 'POST', cookie, body: { orderIds, reason }, timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS },
    );
    if (!res.ok) {
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Bulk freeze failed'), succeeded: 0, failed: orderIds.length });
    }
    const data = res.data?.result?.data;
    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  if (intent === 'bulkUnfreeze') {
    await requirePermission(request, 'orders.freeze');
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const reason = form.get('reason')?.toString() || undefined;
    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number } } }>(
      '/trpc/orders.bulkUnfreezeOrders',
      { method: 'POST', cookie, body: { orderIds, reason }, timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS },
    );
    if (!res.ok) {
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Bulk unfreeze failed'), succeeded: 0, failed: orderIds.length });
    }
    const data = res.data?.result?.data;
    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  return json({ success: false, error: 'Unknown intent' });
}

export default function OfflineOrdersRoute() {
  const { csOrdersShell, pageData } = useLoaderData<typeof loader>() as unknown as {
    csOrdersShell: {
      filters: OrdersListPageProps['filters'];
      scheduleFilters: OrdersListPageProps['scheduleFilters'];
      isCSCloser: boolean;
      showCSCloserColumn: boolean;
      canAssignDirectly: boolean;
      currentUserId: string;
      canCreateOffline: boolean;
      canImportOrders: boolean;
      canFreeze: boolean;
      page: number;
      limit: number;
      statusFilter?: string;
      searchFilter?: string;
    };
    pageData: Promise<
      Pick<
        OrdersListPageProps,
        | 'orders'
        | 'total'
        | 'totalPages'
        | 'page'
        | 'limit'
        | 'statusFilter'
        | 'searchFilter'
        | 'filters'
        | 'scheduleFilters'
        | 'isCSCloser'
        | 'showCSCloserColumn'
        | 'canAssignDirectly'
        | 'currentUserId'
        | 'canCreateOffline'
        | 'canImportOrders'
        | 'canFreeze'
        | 'bulkSelectAllMatchingInput'
        | 'deferredSecondary'
        | 'branchesForMove'
        | 'enableFromCartStatusOption'
        | 'isCartAbandonmentView'
        | 'pageTitle'
        | 'pageDescription'
      >
    >;
  };
  const parentData = useRouteLoaderData('routes/admin') as { user: { role: string } } | undefined;
  const userRole = parentData?.user?.role;
  usePageRefreshOnEvent([...CS_ORDERS_LIVE_EVENTS]);
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <CSOrdersLoadingShell
          filters={csOrdersShell.filters!}
          scheduleFilters={csOrdersShell.scheduleFilters!}
          statusFilter={csOrdersShell.statusFilter}
          searchFilter={csOrdersShell.searchFilter}
          isCSCloser={csOrdersShell.isCSCloser}
          liveEvents={[...CS_ORDERS_LIVE_EVENTS]}
          showCSCloserColumn={csOrdersShell.showCSCloserColumn}
        />
      }
      loaderShell={{ csOrdersShell }}
      deferredKey="pageData"
    >
      {(d) => (
        <OrdersListPage
          {...d}
          userRole={userRole}
          liveEvents={[...CS_ORDERS_LIVE_EVENTS]}
          excludeStatuses={
            userRole === 'CS_CLOSER'
              ? ['REMITTED', 'DELETED', 'UNPROCESSED']
              : ['REMITTED', 'DELETED']
          }
        />
      )}
    </CachedAwait>
  );
}
