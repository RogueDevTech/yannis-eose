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

// Statuses surfaced in the CEO's six-bucket filter (CEO directive 2026-05-09).
// Bookmarked URLs targeting a status outside this set — e.g.
// `?status=DISPATCHED` from the old long dropdown — redirect to the unfiltered
// list so the page stays consistent with what the dropdown can actually pick.
// REMITTED is dropped here too: cash remittance is accountant-led; CS surfaces
// shouldn't filter by it, and a stale `?status=REMITTED` bookmark should bounce.
// DELETED is added explicitly — it's not in STATUS_OPTIONS (six-bucket CEO
// directive) but is reachable via the Deleted tab. CANCELLED is legacy-only.
const CS_ORDERS_VISIBLE_STATUSES = new Set([
  ...STATUS_OPTIONS.filter((s) => s !== 'ALL' && s !== 'REMITTED'),
  'CANCELLED',
  'DELETED',
]);
export const meta: MetaFunction = () => [
  { title: 'Sales Orders — Yannis EOSE' },
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
  // URL-driven page size — clamped to allowed set; default 50.
  const { perPage: ORDERS_PER_PAGE } = parsePerPage(url.searchParams, { defaultPerPage: 50 });
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

  const isCSCloser = user.role === 'CS_CLOSER';
  const assignedCsId = isCSCloser ? user.id : csCloserIdParam;
  // Phase 21 — capability gate now permission-driven so a custom role with
  // `orders.createOffline` can show the offline-entry button without inheriting CS_CLOSER.
  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canCreateOffline =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'CS_CLOSER' ||
    userPerms.includes(canonicalPermissionCode('orders.createOffline'));
  const canExport =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    userPerms.includes(canonicalPermissionCode('orders.export'));
  // SmartPick (bulk N-pick toolbar) requires BOTH `orders.bulkAssign` AND
  // `orders.reassign`. `bulkAssignToCS` calls `assignToCS` per order and that
  // service-level path checks `orders.reassign` (or same-branch + CS-supervisor)
  // — so granting only `orders.bulkAssign` via per-user override would let the
  // SmartPick render but the action would fail loudly. Both codes are bundled
  // together by default in HEAD_OF_CS; admin-class inherits via ALL_PERMISSION_CODES.
  const canBulkPick =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    (userPerms.includes(canonicalPermissionCode('orders.bulkAssign')) &&
      userPerms.includes(canonicalPermissionCode('orders.reassign')));

  // Schedule heat + list both key off callback / preferred delivery dates. The default
  // "this month" strip filters createdAt — that would hide e.g. an April-created order
  // whose preferred_delivery_date is in May, so the calendar shows a dot but the table
  // is empty. Omit creation-period bounds whenever a schedule list filter is active.
  const hasScheduleListFilter =
    scheduleKind === 'callback_due' ||
    scheduleKind === 'delivery_overdue' ||
    (scheduleKind === 'delivery_on_day' && !!scheduleDate) ||
    (scheduleKind === 'callback_on_day' && !!scheduleDate);

  // HoCS-only "Recovered from cart" pill — toggles `fromCart` on the API list.
  // CS_CLOSER never sees the option in the UI, but enforce here so a hand-crafted
  // URL doesn't widen scope. Note: filtering down to `cart_id IS NOT NULL`
  // happens server-side via the partial index added in migration 0142.
  const fromCartParam = url.searchParams.get('fromCart') === '1';
  const canFilterFromCart =
    user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT';
  const fromCart = fromCartParam && canFilterFromCart;

  const testOrdersParam = url.searchParams.get('testOrders') === '1';
  const canFilterTestOrders = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const testOrders = testOrdersParam && canFilterTestOrders;

  const productIdParam = url.searchParams.get('productId') || undefined;
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') || 'desc';

  // For CS/Marketing, DELIVERED and REMITTED are the same outcome ("delivered").
  const expandDeliveredFilter = status === 'DELIVERED';
  const listInput: Record<string, unknown> = {
    page,
    limit: ORDERS_PER_PAGE,
    ...(expandDeliveredFilter
      ? { statuses: ['DELIVERED', 'REMITTED'] }
      : { status: status || undefined }),
    search: search || undefined,
    sortBy,
    sortOrder,
    ...(assignedCsId && { assignedCsId }),
    ...(productIdParam && { productId: productIdParam }),
    ...(fromCart && { fromCart: true }),
    ...(testOrders && { testOrders: true }),
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
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    canCreateOffline,
    canExport,
    canBulkPick,
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
      | 'canExport'
      | 'canBulkPick'
      | 'isCartAbandonmentView'
      | 'bulkSelectAllMatchingInput'
      | 'deferredSecondary'
      | 'branchesForMove'
    >
  > => {
  // Cart-abandonment view: the "Cart abandonment" status pseudo-filter swaps the
  // table from real orders to the un-recovered abandoned-cart backlog. Each cart
  // is mapped into an `Order`-shaped row with the synthetic status `'CART'` so the
  // shared table renders it (the page switches to a read-only cart view).
  let orders: Order[] = [];
  let total = 0;
  let totalPages = 0;
  if (fromCart) {
    // Cart abandonment view shows the full open backlog — no date filter.
    // Only search narrows the results.
    const cartsInput = encodeURIComponent(JSON.stringify({
      page,
      limit: ORDERS_PER_PAGE,
      ...(search && { search }),
    }));
    const cartsRes = await apiRequest<unknown>(`/trpc/cart.listAbandoned?input=${cartsInput}`, {
      method: 'GET',
      cookie,
    });
    const cartsData = cartsRes.ok
      ? (
          cartsRes.data as {
            result?: {
              data?: {
                items: Array<{
                  id: string;
                  customerName: string;
                  customerPhoneDisplay: string;
                  productId: string | null;
                  productName: string | null;
                  campaignId: string | null;
                  campaignName: string | null;
                  updatedAt: string;
                  quantity: number | null;
                }>;
                total: number;
              };
            };
          }
        )?.result?.data
      : null;
    total = cartsData?.total ?? 0;
    totalPages = total === 0 ? 0 : Math.ceil(total / ORDERS_PER_PAGE);
    orders = (cartsData?.items ?? []).map((c) => ({
      id: c.id,
      customerName: c.customerName,
      customerPhoneDisplay: c.customerPhoneDisplay ?? '',
      status: 'CART',
      totalAmount: null,
      createdAt: c.updatedAt,
      assignedCsId: null,
      primaryProductId: c.productId ?? null,
      primaryProductName: c.productName ?? null,
      itemCount: c.quantity ?? 0,
      campaignId: c.campaignId ?? null,
      campaignName: c.campaignName ?? null,
      // Back-link drives the "View cart" quick-detail modal — for a cart row it's the cart's own id.
      cartId: c.id,
    }));
  } else {
    const listRes = await apiRequest<unknown>(`/trpc/orders.list?input=${input}`, { method: 'GET', cookie });
    const trpcData = listRes.ok
      ? (listRes.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;
    orders = trpcData?.orders ?? [];
    total = trpcData?.pagination?.total ?? 0;
    totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);
  }

  const deferredSecondary = (async () => {
    // Single bundle endpoint replaces what used to be 5 (or up to 7 for HoCS /
    // admin) parallel HTTP calls — statusCounts, myCSWorkload (CS_CLOSER only),
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
        isCSCloser,
        showCSCloserColumn,
        canCreateOffline,
        includeCartAbandonment: canFilterFromCart,
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
      cartAbandonmentCount: number | null;
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
      cartAbandonmentCount: bundle?.cartAbandonmentCount ?? null,
    };
  })();

  // Fetch branches for the "Move to branch" bulk action (Admin / HoCS only).
  const canMoveToBranch =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'HEAD_OF_CS';
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
    isCartAbandonmentView: fromCart,
    isCSCloser,
    showCSCloserColumn,
    canAssignDirectly: user.role === 'HEAD_OF_CS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    canCreateOffline,
    canExport,
    canBulkPick,
    productFilter: productIdParam,
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
    // Serialised listInput so the page can power "Select all matching this
    // filter" — fetched client-side via `fetchOrdersMatchingIds` so the same
    // server-side authz/scope as the visible list applies.
    bulkSelectAllMatchingInput: JSON.stringify(listInput),
    deferredSecondary,
  };
  })();

  return defer({
    csOrdersShell,
    pageData,
  } as Record<string, unknown>);
}

/**
 * `clientLoader` for true LinkedIn-style instant revisit — skips the server
 * roundtrip entirely on cache hit, then revalidates in the background once
 * the route has mounted (fired by `<CachedAwait>`'s on-mount revalidator).
 *
 * `hydrate = false`: on initial SSR there's no cache yet, so let the server
 * loader populate the page normally. From there, every subsequent client-side
 * navigation back to this URL within 5 minutes hits the cache.
 */
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
    if (!['CS_CLOSER', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'].includes(createOfflineUser.role)) {
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

    const body =
      csCloserIds.length === 1
        ? { orderIds, csCloserId: csCloserIds[0] }
        : { orderIds, csCloserIds };

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

  if (intent === 'purgeTestOrders') {
    const purgeUser = await requirePermission(request, 'orders.read');
    if (!['SUPER_ADMIN', 'ADMIN'].includes(purgeUser.role)) {
      return json({ error: 'SuperAdmin only' }, { status: 403 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.purgeTestOrders', {
      method: 'POST',
      cookie,
      body: {},
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to clear test orders') }, { status: safeStatus(res.status) });
    }
    const data = (res.data as { result?: { data?: { deleted: number; skipped: number } } })?.result?.data;
    return json({ success: true, deleted: data?.deleted ?? 0, skipped: data?.skipped ?? 0 });
  }

  return json({ success: false, error: 'Unknown intent' });
}

export default function CSOrdersRoute() {
  const { csOrdersShell, pageData } = useLoaderData<typeof loader>() as unknown as {
    csOrdersShell: {
      filters: OrdersListPageProps['filters'];
      scheduleFilters: OrdersListPageProps['scheduleFilters'];
      isCSCloser: boolean;
      showCSCloserColumn: boolean;
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
        | 'isCSCloser'
        | 'showCSCloserColumn'
        | 'canAssignDirectly'
        | 'currentUserId'
        | 'canCreateOffline'
        | 'isCartAbandonmentView'
        | 'bulkSelectAllMatchingInput'
        | 'deferredSecondary'
        | 'branchesForMove'
      >
    >;
  };
  const parentData = useRouteLoaderData('routes/admin') as { user: { role: string } } | undefined;
  const userRole = parentData?.user?.role;
  // HoCS / Admin / SuperAdmin can filter the list to recovered-from-cart
  // orders via the "Cart abandonment" pseudo-option in the status dropdown.
  // CS_CLOSER never sees the option (filter is also enforced server-side).
  const isHoCSPlus =
    userRole === 'HEAD_OF_CS' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'SUPPORT';
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
          // REMITTED is accountant-only. Deleted tab limited to users with
          // orders.delete permission (HoCS / Admin / SuperAdmin by default).
          // UNPROCESSED is hidden for plain CS_CLOSERs — they only ever see
          // orders already assigned to them, so the Unassigned pill is always 0
          // and just steals space from the closer's real funnel (Assigned →
          // Delivered).
          excludeStatuses={
            isHoCSPlus
              ? ['REMITTED', 'DELETED']
              : userRole === 'CS_CLOSER'
                ? ['REMITTED', 'DELETED', 'UNPROCESSED']
                : ['REMITTED', 'DELETED']
          }
          enableFromCartStatusOption={isHoCSPlus}
          enableTestOrdersOption={userRole === 'SUPER_ADMIN' || userRole === 'ADMIN'}
        />
      )}
    </CachedAwait>
  );
}
