import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  apiRequest,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  defaultThisMonthRange,
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
import { CS_ORDERS_STATUS_DROPDOWN_EXCLUDE } from '~/features/shared/order-status';
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

const ORDERS_PER_PAGE = 20;

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
  // Keep `callback_on_day` / `delivery_on_day` in the filter model even before the user picks
  // a date — the list stays unfiltered until `scheduleDate` is set (`hasScheduleListFilter`),
  // but the schedule dropdown + date-picker modal need the kind to show the right copy.

  const now = new Date();
  const defaultCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let calendarMonth =
    calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : defaultCalendarMonth;
  if (scheduleDate && !calendarMonthRaw) {
    calendarMonth = scheduleDate.slice(0, 7);
  }

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  // Optional time-of-day refinement from `<DateFilterBar>` (HH:MM, 24-hour).
  // When present, we combine date+time into an ISO datetime before sending to the
  // API so the EOD bump (which would otherwise stretch the window to 23:59) is
  // skipped. Validators still accept the bare date format for back-compat.
  let startTime = url.searchParams.get('startTime') ?? undefined;
  let endTime = url.searchParams.get('endTime') ?? undefined;
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
    startTime = undefined;
    endTime = undefined;
  }
  // Normalise: a time without a matching date is meaningless.
  if (!startDate) startTime = undefined;
  if (!endDate) endTime = undefined;
  /** Compose an ISO datetime when time is present so the API sees an exact moment.
   *  Otherwise return the bare YYYY-MM-DD which the API expands to whole-day bounds. */
  const composeBound = (date: string | undefined, time: string | undefined): string | undefined => {
    if (!date) return undefined;
    if (!time) return date;
    // Use seconds:00 to keep the boundary deterministic.
    return `${date}T${time}:00`;
  };
  const apiStartDate = composeBound(startDate, startTime);
  const apiEndDate = composeBound(endDate, endTime);

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
  const canExport =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    userPerms.includes(canonicalPermissionCode('orders.export'));

  // Schedule heat + list both key off callback / preferred delivery dates. The default
  // "this month" strip filters createdAt — that would hide e.g. an April-created order
  // whose preferred_delivery_date is in May, so the calendar shows a dot but the table
  // is empty. Omit creation-period bounds whenever a schedule list filter is active.
  const hasScheduleListFilter =
    scheduleKind === 'callback_due' ||
    scheduleKind === 'delivery_overdue' ||
    (scheduleKind === 'delivery_on_day' && !!scheduleDate) ||
    (scheduleKind === 'callback_on_day' && !!scheduleDate);

  const listInput: Record<string, unknown> = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status || undefined,
    search: search || undefined,
    ...(assignedCsId && { assignedCsId }),
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

  const showCSAgentColumn = user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

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
    isCSAgent,
    showCSAgentColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    canCreateOffline,
    canExport,
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
      | 'isCSAgent'
      | 'showCSAgentColumn'
      | 'canAssignDirectly'
      | 'currentUserId'
      | 'canCreateOffline'
      | 'canExport'
      | 'deferredSecondary'
    >
  > => {
  const listRes = await apiRequest<unknown>(`/trpc/orders.list?input=${input}`, { method: 'GET', cookie });

  const trpcData = listRes.ok
    ? (listRes.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;
  const total = trpcData?.pagination?.total ?? 0;
  const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  const deferredSecondary = (async () => {
    // Single bundle endpoint replaces what used to be 5 (or up to 7 for HoCS /
    // admin) parallel HTTP calls — statusCounts, myCSWorkload (CS_AGENT only),
    // timeSeriesByCreated, scheduleCalendarHeat, products.list (offline modal),
    // csWorkloads + logistics.locationOptions (admin column). Same fan-out,
    // one HTTP round-trip and one auth pass.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        countsAssignedCsId: assignedCsId,
        countsStartDate: apiStartDate,
        countsEndDate: apiEndDate,
        trendStatus: status,
        heatYearMonth: calendarMonth,
        heatStatus: status,
        isCSAgent,
        showCSAgentColumn,
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
      csAgentsForFilter: Array<{ agentId: string; agentName: string }>;
      logisticsLocationsForBulk: Array<{ id: string; name: string; providerName: string | null }>;
      productsForOfflineOrder: Array<{
        id: string;
        name: string;
        offers?: Array<{ label: string; price: string; qty: number }>;
      }>;
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    return {
      statusCounts: bundle?.statusCounts ?? {},
      dailyCounts: bundle?.dailyCounts ?? [],
      scheduleHeat: bundle?.scheduleHeat ?? [],
      myWorkload: bundle?.myWorkload ?? null,
      csAgentsForFilter: bundle?.csAgentsForFilter ?? [],
      logisticsLocationsForBulk: bundle?.logisticsLocationsForBulk ?? [],
      productsForOfflineOrder: bundle?.productsForOfflineOrder ?? [],
    };
  })();

  return {
    orders: trpcData?.orders ?? [],
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search,
    isCSAgent,
    showCSAgentColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    canCreateOffline,
    canExport,
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
    deferredSecondary,
  };
  })();

  return defer({
    csOrdersShell,
    pageData,
  } as Record<string, unknown>);
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
    const csAgentIdsRaw = form.get('csAgentIds')?.toString();
    const csAgentIdSingle = (form.get('csAgentId') as string | null) ?? '';

    let csAgentIds: string[] = [];
    if (csAgentIdsRaw) {
      try {
        const parsed = JSON.parse(csAgentIdsRaw) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          csAgentIds = parsed as string[];
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
    if (csAgentIds.length === 0 && csAgentIdSingle) {
      csAgentIds = [csAgentIdSingle];
    }
    if (csAgentIds.length === 0) {
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

    const body =
      csAgentIds.length === 1
        ? { orderIds, csAgentId: csAgentIds[0] }
        : { orderIds, csAgentIds };

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

  return json({ success: false, error: 'Unknown intent' });
}

export default function CSOrdersRoute() {
  const { csOrdersShell, pageData } = useLoaderData<typeof loader>() as unknown as {
    csOrdersShell: {
      filters: OrdersListPageProps['filters'];
      scheduleFilters: OrdersListPageProps['scheduleFilters'];
      isCSAgent: boolean;
      showCSAgentColumn: boolean;
      canAssignDirectly: boolean;
      currentUserId: string;
      canCreateOffline: boolean;
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
        | 'isCSAgent'
        | 'showCSAgentColumn'
        | 'canAssignDirectly'
        | 'currentUserId'
        | 'canCreateOffline'
        | 'deferredSecondary'
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
          isCSAgent={csOrdersShell.isCSAgent}
          liveEvents={[...CS_ORDERS_LIVE_EVENTS]}
          showCSAgentColumn={csOrdersShell.showCSAgentColumn}
        />
      }
    >
      {(d) => (
        <OrdersListPage
          {...d}
          statusCounts={{}}
          userRole={userRole}
          liveEvents={[...CS_ORDERS_LIVE_EVENTS]}
        />
      )}
    </CachedAwait>
  );
}
