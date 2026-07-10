import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json, redirect } from '@remix-run/node';
import { useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import type { ShouldRevalidateFunction } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  getCurrentUser,
  requirePermissionOrRoles,
  safeStatus,
  parsePerPage,
  defaultThisMonthRange,
  DEFERRED_LOADER_TIMEOUT_MS,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpPage } from '~/features/cs/FollowUpPage';
import type { FollowUpPageData } from '~/features/cs/FollowUpPage';
import { FollowUpBatchesPage } from '~/features/cs/FollowUpBatchesPage';
import type { FollowUpBranchRow } from '~/features/cs/FollowUpBatchesPage';
import type { PendingCart } from '~/features/cs/types';
import { FollowUpOrdersPage } from '~/features/cs/FollowUpOrdersPage';
import { OrdersListPage } from '~/features/orders/OrdersListPage';
import type { Order } from '~/features/orders/types';
import { FollowUpBatchesLoadingShell, FollowUpOrdersLoadingShell } from '~/features/cs/CSDeferredLoadingShells';
import { AdminErrorBoundary } from '~/features/admin-layout/AdminErrorBoundary';

export const meta: MetaFunction = () => [
  { title: 'Follow Up — Yannis EOSE' },
];

export const shouldRevalidate: ShouldRevalidateFunction = ({
  defaultShouldRevalidate,
  formMethod,
  currentUrl,
  nextUrl,
}) => {
  // Always revalidate after mutations
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate;
  // Revalidate when search params change (filters, search, pagination)
  if (currentUrl.search !== nextUrl.search) return true;
  return false;
};

const ABANDONED_CART_STATUS = 'ABANDONED_CART';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HEAD_OF_CS', 'CS_CLOSER'],
  });
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const isCloser = user?.role === 'CS_CLOSER';
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'SUPPORT';
  const isHoCS = user?.role === 'HEAD_OF_CS';
  // Everyone lands on the orders list — same pattern as Order Funnel and Cart Orders.
  const view = url.searchParams.get('view') || 'orders';

  // ── Follow-Up Orders view ────────────────────────────────────
  if (view === 'orders') {
    const statusParam = url.searchParams.get('status') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const csCloserId = url.searchParams.get('csCloserId') || undefined;
    const assignedCsId = isCloser ? user.id : csCloserId;
    const unassignedOnly = url.searchParams.get('unassigned') === '1' && !isCloser;
    const perPage = Math.min(Math.max(parseInt(url.searchParams.get('perPage') || '50', 10), 10), 100);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const sortBy = url.searchParams.get('sortBy') || 'createdAt';
    const sortOrder = url.searchParams.get('sortOrder') || 'desc';

    const ruleId = url.searchParams.get('ruleId') || undefined;
    const periodAllTime = url.searchParams.get('period') === 'all_time';
    const defaultDates = periodAllTime ? { startDate: undefined, endDate: undefined } : defaultThisMonthRange();
    const startDate = url.searchParams.get('startDate') || (periodAllTime ? undefined : defaultDates.startDate);
    const endDate = url.searchParams.get('endDate') || (periodAllTime ? undefined : defaultDates.endDate);
    const branchId = url.searchParams.get('branchId') || undefined;
    const backToParam = url.searchParams.get('backTo') || undefined;

    const isDeletedFilter = statusParam === 'DELETED';
    const listInput: Record<string, unknown> = { page, limit: perPage, sortBy, sortOrder };
    if (isDeletedFilter) {
      listInput.showDeleted = true;
    } else if (statusParam) {
      listInput.status = statusParam;
    }
    if (search) listInput.search = search;
    if (assignedCsId) listInput.assignedCsId = assignedCsId;
    if (unassignedOnly) listInput.unassignedOnly = true;
    if (ruleId) listInput.ruleId = ruleId;
    if (startDate) listInput.startDate = startDate;
    if (endDate) listInput.endDate = endDate;
    if (branchId) listInput.branchId = branchId;
    const listInputStr = encodeURIComponent(JSON.stringify(listInput));

    const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

    // Branch name for page title — resolved inside pageData (non-blocking) to avoid delaying the shell.
    // branches.list is also used for the "move to branch" picker, so one call serves both.
    const pageData = (async () => {
      try {
      const [ordersRes, countsRes, closersRes, branchesRes] = await Promise.all([
        apiRequest<unknown>(`/trpc/orders.followUpOrdersList?input=${listInputStr}`, deferredOpt),
        apiRequest<unknown>(`/trpc/orders.followUpOrdersStatusCounts?input=${encodeURIComponent(JSON.stringify({
          ...(branchId ? { branchId } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        }))}`, deferredOpt).catch(() => ({ ok: false as const, status: 500, data: null })),
        apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches?input=%7B%7D', deferredOpt).catch(() => ({ ok: false as const, status: 500, data: null })),
        apiRequest<{ result?: { data?: Array<{ id: string; name: string }> } }>('/trpc/branches.list', { method: 'GET', cookie }).catch(() => ({ ok: false as const, status: 500, data: null })),
      ]);
      const ordersRaw = (ordersRes.ok ? (ordersRes.data as { result?: { data?: unknown } })?.result?.data : null) as { orders: unknown[]; pagination: { total: number } } | null;
      const countsData = (countsRes.ok ? (countsRes.data as { result?: { data?: unknown } })?.result?.data : null) as Record<string, number> | null;
      type CloserItem = { agentId: string; agentName: string };
      const closersData = (closersRes.ok ? (closersRes.data as { result?: { data?: CloserItem[] } })?.result?.data : null) ?? [];
      type BranchItem = { id: string; name: string };
      const branchesData: BranchItem[] = (branchesRes.ok ? (branchesRes.data as { result?: { data?: BranchItem[] } })?.result?.data : null) ?? [];

      // Resolve branch name from the already-fetched branches list (no extra call).
      const branchName = branchId
        ? branchesData.find((b) => b.id === branchId)?.name ?? ''
        : '';

      // Map follow-up orders to the Order type used by OrdersListPage
      const orders: Order[] = ((ordersRaw?.orders ?? []) as Array<Record<string, unknown>>).map((o) => ({
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
        primaryProductName: (o.primaryProductName as string) ?? null,
        itemCount: (o.itemCount as number) ?? 0,
        campaignId: (o.campaignId as string) ?? null,
        campaignName: (o.campaignName as string) ?? null,
        cartId: null,
        isDuplicate: null,
        lastCsComment: null,
      }));

      const total = ordersRaw?.pagination?.total ?? 0;
      return {
        orders,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        statusCounts: countsData ?? {},
        csClosersForFilter: closersData,
        branchesForMove: branchesData,
        branchName,
      };
      } catch {
        return { orders: [] as Order[], total: 0, totalPages: 1, statusCounts: {} as Record<string, number>, csClosersForFilter: [] as Array<{ agentId: string; agentName: string }>, branchesForMove: [] as Array<{ id: string; name: string }>, branchName: '' };
      }
    })();

    return defer({
      shell: {
        view: 'orders' as const,
        status: statusParam ?? '',
        search: search ?? '',
        csCloserId: csCloserId ?? '',
        page,
        perPage,
        sortBy,
        sortOrder,
        isCloser,
        isAdmin,
        userRole: user?.role ?? '',
        userId: user?.id ?? '',
        branchId: branchId ?? '',
        startDate: startDate ?? '',
        endDate: endDate ?? '',
        backTo: backToParam ?? '',
        bulkSelectAllMatchingInput: JSON.stringify(listInput),
      },
      pageData,
    });
  }

  // Groups view moved to config page
  if (view === 'groups') {
    return redirect('/admin/settings/follow-up-config?tab=groups');
  }

  // ── Branches view (default for non-closers) ─────────────────
  if (view === 'batches' || (view !== 'create' && view !== 'orders')) {
    const batchesPeriodAllTime = url.searchParams.get('period') === 'all_time';
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const defaultEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const startDate = batchesPeriodAllTime ? '' : (url.searchParams.get('startDate') || defaultStart);
    const endDate = batchesPeriodAllTime ? '' : (url.searchParams.get('endDate') || defaultEnd);

    const branchInput = { ...(startDate && { startDate }), ...(endDate && { endDate }) };
    const batchesData = (async () => {
      try {
        const res = await apiRequest<unknown>(
          `/trpc/orders.listFollowUpBranches?input=${encodeURIComponent(JSON.stringify(branchInput))}`,
          { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
        );
        const branches: FollowUpBranchRow[] = res.ok
          ? ((res.data as { result?: { data?: FollowUpBranchRow[] } })?.result?.data ?? [])
          : [];
        return { branches };
      } catch {
        return { branches: [] as FollowUpBranchRow[] };
      }
    })();
    return defer({
      shell: { view: 'batches' as const, startDate, endDate, periodAllTime: batchesPeriodAllTime, isCloser, userId: user?.id },
      batchesData,
    });
  }

  // ── Create view — order/cart picker ─────────────────────────
  const ALL_FOLLOW_UP_STATUSES = [
    'DELETED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED',
    'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED',
  ];
  const statusParam = url.searchParams.get('statuses') || '';
  const statuses = statusParam.split(',').filter(Boolean);
  const isCartView = statuses.length === 1 && statuses[0] === ABANDONED_CART_STATUS;
  const search = url.searchParams.get('search') || undefined;
  const assignedCsId = url.searchParams.get('assignedCsId') || undefined;
  const customStartDate = url.searchParams.get('startDate') || undefined;
  const customEndDate = url.searchParams.get('endDate') || undefined;
  // Default to 14 days minimum — follow-up targets stale orders, not fresh ones.
  const olderThanDays = url.searchParams.get('olderThanDays') || (!customStartDate && !customEndDate ? '14' : undefined);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage: limit } = parsePerPage(url.searchParams);

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const countsInputStr = encodeURIComponent(JSON.stringify({ statuses: ALL_FOLLOW_UP_STATUSES, isFollowUp: true }));

  // Build the order list input upfront so it can be serialized for deep-select.
  const listInput: Record<string, unknown> = { page, limit, sortBy: 'createdAt', sortOrder: 'desc', excludeFollowUp: false };
  if (!isCartView && statuses.length > 0) {
    const orderStatuses = statuses.filter((s) => s !== ABANDONED_CART_STATUS);
    if (orderStatuses.length === 1) listInput.status = orderStatuses[0];
    else if (orderStatuses.length > 1) listInput.statuses = orderStatuses;
    if (search) listInput.search = search;
    if (assignedCsId) listInput.assignedCsId = assignedCsId;
    if (customStartDate || customEndDate) {
      if (customStartDate) listInput.startDate = customStartDate;
      if (customEndDate) listInput.endDate = customEndDate;
    } else if (olderThanDays) {
      const days = parseInt(olderThanDays, 10);
      if (Number.isFinite(days) && days > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        listInput.endDate = cutoff.toISOString().slice(0, 10);
      }
    }
  }

  const pageData = (async (): Promise<FollowUpPageData> => {
    const [closersRes, countsRes, productsRes, cartStatsRes, groupsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/orders.listCSClosers', deferredOpt),
      apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, deferredOpt),
      apiRequest<unknown>(
        `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
        deferredOpt,
      ),
      apiRequest<unknown>('/trpc/cart.getStats?input=%7B%7D', deferredOpt),
      apiRequest<unknown>('/trpc/orders.listFollowUpGroups', deferredOpt),
    ]);

    const closers = closersRes.ok
      ? ((closersRes.data as { result?: { data?: Array<{ agentId: string; agentName: string }> } })?.result?.data ?? [])
      : [];
    const statusCounts = countsRes.ok
      ? ((countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {})
      : {};
    const products = productsRes.ok
      ? ((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? [])
      : [];
    const cartStats = cartStatsRes.ok
      ? ((cartStatsRes.data as { result?: { data?: { abandonedOpen: number } } })?.result?.data ?? { abandonedOpen: 0 })
      : { abandonedOpen: 0 };

    type FollowUpGroupOption = { id: string; name: string; memberCount: number; members: Array<{ userId: string; userName: string }> };
    const groups: FollowUpGroupOption[] = groupsRes.ok
      ? ((groupsRes.data as { result?: { data?: FollowUpGroupOption[] } })?.result?.data ?? [])
      : [];

    statusCounts[ABANDONED_CART_STATUS] = cartStats.abandonedOpen;

    if (statuses.length === 0) {
      return { orders: [], total: 0, totalPages: 1, closers, statusCounts, products, abandonedCarts: [], abandonedCartsTotal: 0, abandonedCartsTotalPages: 1, groups };
    }

    if (isCartView) {
      const cartInput: Record<string, unknown> = { page, limit };
      if (search) cartInput.search = search;
      if (customStartDate || customEndDate) {
        if (customStartDate) cartInput.startDate = customStartDate;
        if (customEndDate) cartInput.endDate = customEndDate;
      } else if (olderThanDays) {
        const days = parseInt(olderThanDays, 10);
        if (Number.isFinite(days) && days > 0) {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          cartInput.endDate = cutoff.toISOString().slice(0, 10);
        }
      }
      const cartRes = await apiRequest<unknown>(
        `/trpc/cart.listAbandoned?input=${encodeURIComponent(JSON.stringify(cartInput))}`,
        deferredOpt,
      );
      const cartData = cartRes.ok
        ? (cartRes.data as { result?: { data?: { items: PendingCart[]; total: number; page: number; limit: number } } })?.result?.data
        : null;
      return { orders: [], total: 0, totalPages: 1, closers, statusCounts, products, abandonedCarts: cartData?.items ?? [], abandonedCartsTotal: cartData?.total ?? 0, abandonedCartsTotalPages: Math.max(1, Math.ceil((cartData?.total ?? 0) / limit)), groups };
    }

    const ordersRes = await apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      deferredOpt,
    );
    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: FollowUpPageData['orders']; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;
    return { orders: ordersData?.orders ?? [], total: ordersData?.pagination?.total ?? 0, totalPages: ordersData?.pagination?.totalPages ?? 1, limit, closers, statusCounts, products, abandonedCarts: [], abandonedCartsTotal: 0, abandonedCartsTotalPages: 1, groups };
  })();

  // Serialize the listInput so the component can use it for deep-select
  // (cross-page "Select all matching" via fetchOrdersMatchingIds).
  const bulkSelectAllMatchingInput = !isCartView && statuses.length > 0
    ? JSON.stringify(listInput)
    : undefined;

  return defer({
    shell: {
      view: 'create' as const,
      statuses: statusParam,
      search: search ?? '',
      assignedCsId: assignedCsId ?? '',
      olderThanDays: olderThanDays ?? '',
      startDate: customStartDate ?? '',
      endDate: customEndDate ?? '',
      periodAllTime,
      page,
      bulkSelectAllMatchingInput,
    },
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
  });
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'reopenForFollowUp') {
    let orderIds: string[];
    try {
      orderIds = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
      if (!Array.isArray(orderIds)) throw new Error();
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }
    if (orderIds.length === 0) {
      return json({ error: 'Select at least one order' }, { status: 400 });
    }
    const targetBranchId = formData.get('targetBranchId')?.toString() || undefined;
    const batchName = formData.get('batchName')?.toString()?.trim() || '';
    const groupId = formData.get('groupId')?.toString() || undefined;
    const assignmentMode = (formData.get('assignmentMode')?.toString() as 'EQUAL' | 'MANUAL') || 'MANUAL';
    let originalStatuses: Record<string, string> = {};
    try { originalStatuses = JSON.parse(formData.get('originalStatuses')?.toString() ?? '{}'); } catch { /* ignore */ }

    const res = await apiRequest<unknown>('/trpc/orders.reopenForFollowUp', {
      method: 'POST',
      cookie,
      body: { orderIds, ...(targetBranchId ? { targetBranchId } : {}) },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reopen orders') },
        { status: safeStatus(res.status) },
      );
    }
    const data = (res.data as { result?: { data?: { succeeded: number; failed: number; results?: Array<{ orderId: string; newOrderId: string; success: boolean }> } } })?.result?.data;
    const succeededResults = (data?.results ?? []).filter((r) => r.success);
    const newOrderIds = succeededResults.map((r) => r.newOrderId).filter(Boolean);

    // Create batch record using the NEW copy order IDs
    if (batchName && newOrderIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.createFollowUpBatch', {
        method: 'POST',
        cookie,
        body: {
          name: batchName,
          source: 'orders',
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          ...(groupId ? { groupId } : {}),
          assignmentMode,
          items: succeededResults.map((r) => ({ orderId: r.newOrderId, originalStatus: originalStatuses[r.orderId] ?? r.orderId })),
        },
      });
    }

    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  if (intent === 'createOfflineOrder') {
    const itemsRaw = formData.get('items')?.toString();
    let items: Array<{ productId: string; quantity: number; unitPrice: string; offerLabel?: string }>;
    try {
      items = JSON.parse(itemsRaw || '[]');
    } catch {
      return json({ error: 'Invalid items' }, { status: 400 });
    }
    const customerName = formData.get('customerName')?.toString()?.trim() ?? '';
    const customerPhone = formData.get('customerPhone')?.toString()?.trim() ?? '';
    if (customerName.length < 2) return json({ error: 'Customer name is required (min 2 characters)' }, { status: 400 });
    if (!customerPhone) return json({ error: 'Customer phone is required' }, { status: 400 });
    if (!items.length || items.some((i) => !i.productId || !i.quantity)) {
      return json({ error: 'At least one valid item is required' }, { status: 400 });
    }

    const body: Record<string, unknown> = {
      customerName,
      customerPhone,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice) || 0,
        ...(i.offerLabel ? { offerLabel: i.offerLabel } : {}),
      })),
    };
    const cartId = formData.get('cartId')?.toString()?.trim();
    if (cartId) body.cartId = cartId;
    const customerAddress = formData.get('customerAddress')?.toString()?.trim();
    if (customerAddress) body.customerAddress = customerAddress;
    const deliveryAddress = formData.get('deliveryAddress')?.toString()?.trim();
    if (deliveryAddress) body.deliveryAddress = deliveryAddress;
    const deliveryNotes = formData.get('deliveryNotes')?.toString()?.trim();
    if (deliveryNotes) body.deliveryNotes = deliveryNotes;
    const deliveryState = formData.get('deliveryState')?.toString()?.trim();
    if (deliveryState) body.deliveryState = deliveryState;
    const customerGender = formData.get('customerGender')?.toString()?.trim();
    if (customerGender) body.customerGender = customerGender;
    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString()?.trim();
    if (preferredDeliveryDate) body.preferredDeliveryDate = preferredDeliveryDate;
    const paymentMethod = formData.get('paymentMethod')?.toString()?.trim();
    if (paymentMethod) body.paymentMethod = paymentMethod;
    const customerEmail = formData.get('customerEmail')?.toString()?.trim();
    if (paymentMethod === 'PAY_ONLINE' && !customerEmail) {
      return json({ error: 'Email required for online payment' }, { status: 400 });
    }
    if (customerEmail) body.customerEmail = customerEmail;
    const totalAmount = formData.get('totalAmount')?.toString()?.trim();
    if (totalAmount) body.totalAmount = Number(totalAmount);

    const res = await apiRequest<unknown>('/trpc/orders.createOffline', {
      method: 'POST',
      cookie,
      body,
      timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create offline order') }, { status: safeStatus(res.status) });
    }
    const orderId = (res.data as { result?: { data?: { id: string } } })?.result?.data?.id;
    return json({ success: true, orderId });
  }

  if (intent === 'bulkRecoverCarts') {
    let cartIds: string[];
    try {
      cartIds = JSON.parse(formData.get('cartIds')?.toString() ?? '[]');
      if (!Array.isArray(cartIds)) throw new Error();
    } catch {
      return json({ error: 'Invalid cart IDs' }, { status: 400 });
    }
    if (cartIds.length === 0) {
      return json({ error: 'Select at least one cart' }, { status: 400 });
    }
    const targetBranchId = formData.get('targetBranchId')?.toString() || undefined;

    // Single bulk call — recovers all carts in chunked parallel on the server.
    const bulkRes = await apiRequest<unknown>('/trpc/orders.bulkRecoverCarts', {
      method: 'POST',
      cookie,
      body: { cartIds },
      timeoutMs: 60_000,
    });
    if (!bulkRes.ok) {
      return json({ error: extractApiErrorMessage(bulkRes.data, 'Failed to recover carts') }, { status: safeStatus(bulkRes.status) });
    }
    const bulkData = (bulkRes.data as { result?: { data?: { succeeded: number; failed: number; orderIds: string[] } } })?.result?.data;
    const succeeded = bulkData?.succeeded ?? 0;
    const failed = bulkData?.failed ?? 0;
    const createdOrderIds = bulkData?.orderIds ?? [];

    // Move created orders to the target CS branch if specified.
    if (targetBranchId && createdOrderIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.moveOrdersToBranch', {
        method: 'POST',
        cookie,
        body: { orderIds: createdOrderIds, targetBranchId },
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      });
    }

    // Create batch record for tracking
    const batchName = formData.get('batchName')?.toString()?.trim() || '';
    const cartGroupId = formData.get('groupId')?.toString() || undefined;
    const cartAssignmentMode = (formData.get('assignmentMode')?.toString() as 'EQUAL' | 'MANUAL') || 'MANUAL';
    if (batchName && createdOrderIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.createFollowUpBatch', {
        method: 'POST',
        cookie,
        body: {
          name: batchName,
          source: 'carts',
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          ...(cartGroupId ? { groupId: cartGroupId } : {}),
          assignmentMode: cartAssignmentMode,
          items: createdOrderIds.map((id) => ({ orderId: id, originalStatus: 'ABANDONED_CART' })),
        },
      });
    }

    return json({ success: true, succeeded, failed });
  }

  // ── Group CRUD ──────────────────────────────────────────────
  if (intent === 'createFollowUpGroup') {
    const name = formData.get('groupName')?.toString()?.trim() ?? '';
    if (!name) return json({ error: 'Group name is required' }, { status: 400 });
    let memberIds: string[];
    try { memberIds = JSON.parse(formData.get('memberIds')?.toString() ?? '[]'); } catch { memberIds = []; }
    if (memberIds.length === 0) return json({ error: 'Select at least one member' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.createFollowUpGroup', {
      method: 'POST', cookie, body: { name, memberIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'updateFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString();
    if (!groupId) return json({ error: 'Group ID is required' }, { status: 400 });
    const name = formData.get('groupName')?.toString()?.trim() || undefined;
    let memberIds: string[] | undefined;
    const memberIdsRaw = formData.get('memberIds')?.toString();
    if (memberIdsRaw) { try { memberIds = JSON.parse(memberIdsRaw); } catch { memberIds = undefined; } }

    const res = await apiRequest<unknown>('/trpc/orders.updateFollowUpGroup', {
      method: 'POST', cookie, body: { groupId, name, memberIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'deleteFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString();
    if (!groupId) return json({ error: 'Group ID is required' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.deleteFollowUpGroup', {
      method: 'POST', cookie, body: { groupId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  // ── OrdersListPage bulk assign (maps to follow-up assign) ────
  if (intent === 'bulkAssign') {
    const orderIds = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
    const csCloserIds = JSON.parse(formData.get('csCloserIds')?.toString() ?? '[]');
    if (!orderIds.length || !csCloserIds.length) return json({ error: 'Orders and closers required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersBulkAssign', {
      method: 'POST', cookie, body: { orderIds, closerIds: csCloserIds }, timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { assigned?: number; sameCloserSkipped?: string[] } } })?.result?.data;
    const skipped = data?.sameCloserSkipped?.length ?? 0;
    return json({
      success: true,
      assigned: data?.assigned ?? 0,
      message: skipped > 0
        ? `Assigned ${data?.assigned ?? 0} orders. ${skipped} skipped (same closer as original).`
        : `Assigned ${data?.assigned ?? 0} orders.`,
    });
  }

  // ── OrdersListPage bulk transition (maps to follow-up status transition) ──
  if (intent === 'bulkTransition') {
    const orderIds: string[] = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
    const newStatus = formData.get('newStatus')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() ?? undefined;
    if (!orderIds.length || !newStatus) return json({ error: 'Orders and status required' }, { status: 400 });
    const results = await Promise.all(
      orderIds.map((orderId: string) =>
        apiRequest<unknown>('/trpc/orders.followUpOrdersTransition', {
          method: 'POST', cookie,
          body: { orderId, newStatus, ...(reason ? { note: reason } : {}) },
          timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
        }).then((res) => res.ok).catch(() => false),
      ),
    );
    const succeeded = results.filter(Boolean).length;
    const failed = results.length - succeeded;
    return json({
      success: succeeded > 0,
      message: failed > 0
        ? `${succeeded} succeeded, ${failed} failed.`
        : `${succeeded} orders updated.`,
      succeeded,
      failed,
    });
  }

  // ── Move orders to branch (bulk transfer from OrdersListPage) ──
  if (intent === 'moveOrdersToBranch') {
    const orderIds: string[] = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
    const targetBranchId = formData.get('targetBranchId')?.toString();
    if (!orderIds.length || !targetBranchId) return json({ error: 'Orders and branch required' }, { status: 400 });
    const results = await Promise.all(
      orderIds.map((orderId: string) =>
        apiRequest<unknown>('/trpc/orders.transferFollowUpOrder', {
          method: 'POST', cookie, body: { orderId, targetBranchId },
          timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
        }).then((res) => res.ok).catch(() => false),
      ),
    );
    const succeeded = results.filter(Boolean).length;
    const failed = results.length - succeeded;
    return json({
      success: succeeded > 0,
      succeeded,
      failed,
      message: failed > 0
        ? `Moved ${succeeded} orders. ${failed} failed.`
        : `Moved ${succeeded} orders to new branch.`,
    });
  }

  // ── Transfer follow-up order to another branch ───────────────
  if (intent === 'transferFollowUpOrder') {
    const orderId = formData.get('orderId')?.toString();
    const targetBranchId = formData.get('targetBranchId')?.toString();
    if (!orderId || !targetBranchId) return json({ error: 'Order ID and target branch required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.transferFollowUpOrder', {
      method: 'POST', cookie, body: { orderId, targetBranchId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to transfer') }, { status: safeStatus(res.status) });
    return json({ success: true, message: 'Order transferred to new branch' });
  }

  // ── OrdersListPage inline assign — routes to follow-up assign ──
  if (intent === 'assignToCS') {
    const orderId = formData.get('orderId')?.toString();
    const closerId = formData.get('toCsAgentId')?.toString();
    if (!orderId || !closerId) return json({ error: 'Order ID and closer ID required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersAssign', {
      method: 'POST', cookie, body: { orderId, closerId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  // ── Follow-up orders single assign (with same-closer check) ──
  if (intent === 'assignFollowUpOrder') {
    const orderId = formData.get('orderId')?.toString();
    const closerId = formData.get('closerId')?.toString();
    const force = formData.get('force') === 'true';
    if (!orderId || !closerId) return json({ error: 'Order ID and closer ID required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersAssign', {
      method: 'POST', cookie, body: { orderId, closerId, force },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { sameCloserWarning?: boolean; originalCloserName?: string; message?: string; success?: boolean } } })?.result?.data;
    if (data?.sameCloserWarning) {
      return json({ sameCloserWarning: true, originalCloserName: data.originalCloserName, message: data.message });
    }
    return json({ success: true, message: 'Order assigned' });
  }

  // ── Follow-up orders bulk assign ──────────────────────────────
  if (intent === 'bulkAssignFollowUpOrders') {
    const orderIds = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
    const closerIds = JSON.parse(formData.get('closerIds')?.toString() ?? '[]');
    const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersBulkAssign', {
      method: 'POST', cookie, body: { orderIds, closerIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to assign') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { assigned?: number; sameCloserSkipped?: string[] } } })?.result?.data;
    const skipped = data?.sameCloserSkipped?.length ?? 0;
    const msg = skipped > 0
      ? `Assigned ${data?.assigned ?? 0} orders. ${skipped} skipped (same closer as original).`
      : `Assigned ${data?.assigned ?? 0} orders.`;
    return json({ success: true, assigned: data?.assigned ?? 0, message: msg });
  }

  // ── OrdersListPage single transition — routes to follow-up transition ──
  if (intent === 'transition') {
    const orderId = formData.get('orderId')?.toString();
    const newStatus = formData.get('newStatus')?.toString();
    const reason = formData.get('reason')?.toString() || undefined;
    if (!orderId || !newStatus) return json({ error: 'Order ID and status required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersTransition', {
      method: 'POST', cookie,
      body: { orderId, newStatus, ...(reason ? { note: reason } : {}) },
      timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Transition failed') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;
  const errorData = isResponse ? error.data : error instanceof Error ? error.message : undefined;
  return (
    <AdminErrorBoundary
      error={error}
      isResponse={isResponse}
      status={status}
      errorData={errorData}
      homePath="/admin"
      homeLabel="Dashboard"
    />
  );
}

export default function FollowUpRoute() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaderData = useLoaderData<typeof loader>() as any;
  const shell = loaderData.shell;
  const view: string = shell?.view ?? 'batches';

  if (view === 'orders') {
    type OrdersBundle = {
      orders: Order[];
      total: number;
      totalPages: number;
      statusCounts: Record<string, number>;
      csClosersForFilter: Array<{ agentId: string; agentName: string }>;
      branchesForMove: Array<{ id: string; name: string }>;
      branchName: string;
    };
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
      canBulkPick: !shell?.isCloser,
      canAssignDirectly: !shell?.isCloser,
      orderDetailFrom: 'followup' as const,
      backTo: shell?.backTo || undefined,
      detailBasePath: '/admin/orders',
      hideOfflineAndCartStats: true,
      filters: {
        startDate: shell?.startDate ?? '',
        endDate: shell?.endDate ?? '',
        periodAllTime: false,
      },
    };
    return (
      <CachedAwait<OrdersBundle>
        resolve={loaderData.pageData as Promise<OrdersBundle>}
        fallback={
          <FollowUpOrdersLoadingShell
            pageTitle="Follow-Up Orders"
            pageDescription="Orders pulled by follow-up rules for re-engagement."
            backTo={baseShellProps.backTo}
          />
        }
        loaderShell={{ shell }}
        deferredKey="pageData"
      >
        {(data) => {
          const resolvedBranchName = (data as OrdersBundle).branchName ?? '';
          const pageTitle = resolvedBranchName ? `Follow-Up · ${resolvedBranchName}` : 'Follow-Up Orders';
          const pageDescription = resolvedBranchName ? `Follow-up orders for ${resolvedBranchName}.` : 'Orders pulled by follow-up rules for re-engagement.';
          return (
          <OrdersListPage
            orders={data.orders ?? []}
            total={data.total ?? 0}
            totalPages={data.totalPages ?? 1}
            statusCounts={data.statusCounts ?? {}}
            csClosersForFilter={data.csClosersForFilter ?? []}
            branchesForMove={data.branchesForMove ?? []}
            myWorkload={null}
            excludeStatuses={['REMITTED']}
            pageTitle={pageTitle}
            pageDescription={pageDescription}
            bulkSelectAllMatchingInput={shell?.bulkSelectAllMatchingInput}
            bulkSelectEndpoint="orders.followUpOrdersList"
            bulkMovePerItem
            {...baseShellProps}
          />
          );
        }}
      </CachedAwait>
    );
  }

  if (view === 'batches') {
    type BranchesBundle = { branches: FollowUpBranchRow[] };
    return (
      <CachedAwait<BranchesBundle>
        resolve={loaderData.batchesData as Promise<BranchesBundle>}
        fallback={
          <FollowUpBatchesPage
            branches={[]}
            startDate={shell?.startDate ?? ''}
            endDate={shell?.endDate ?? ''}
            periodAllTime={shell?.periodAllTime ?? false}
            isCloser={shell?.isCloser ?? false}
            deferredLoading
          />
        }
        loaderShell={{ shell }}
        deferredKey="batchesData"
      >
        {(data) => (
          <FollowUpBatchesPage
            branches={data.branches}
            startDate={shell?.startDate ?? ''}
            endDate={shell?.endDate ?? ''}
            periodAllTime={shell?.periodAllTime ?? false}
            isCloser={shell?.isCloser ?? false}
          />
        )}
      </CachedAwait>
    );
  }

  const filters = {
    view: 'create',
    statuses: shell?.statuses ?? '',
    search: shell?.search ?? '',
    assignedCsId: shell?.assignedCsId ?? '',
    olderThanDays: shell?.olderThanDays ?? '',
    startDate: shell?.startDate ?? '',
    endDate: shell?.endDate ?? '',
    periodAllTime: shell?.periodAllTime ?? false,
    page: shell?.page ?? 1,
  };
  const bulkSelectAllMatchingInput: string | undefined = shell?.bulkSelectAllMatchingInput;
  return (
    <CachedAwait<FollowUpPageData>
      resolve={loaderData.pageData as Promise<FollowUpPageData>}
      fallback={
        <FollowUpPage
          orders={[]}
          total={0}
          totalPages={1}
          closers={[]}
          statusCounts={{}}
          products={[]}
          abandonedCarts={[]}
          abandonedCartsTotal={0}
          abandonedCartsTotalPages={1}
          filters={filters}
          deferredLoading
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <FollowUpPage
          {...data}
          filters={filters}
          bulkSelectAllMatchingInput={bulkSelectAllMatchingInput}
        />
      )}
    </CachedAwait>
  );
}
