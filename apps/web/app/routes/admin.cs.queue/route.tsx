import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import {
  apiRequest,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  safeStatus,
  defaultTodayRange,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CSDashboardPage } from '~/features/cs/CSDashboardPage';
import {
  type AgentWorkload,
  type InactiveAgent,
  type CSOrder,
  type DuplicatePair,
  type CSLeaderboardEntry,
  type PendingCart,
  type LiveActivityItem,
} from '~/features/cs/types';

/** SuperAdmin / org-wide heads often have `currentBranchId: null`; tRPC requires explicit `branchId` on branch-scoped mutations. */
function branchIdFromForm(formData: FormData): string | undefined {
  const raw = formData.get('branchId')?.toString()?.trim();
  if (!raw || raw.length < 32) return undefined;
  return raw;
}

const CS_QUEUE_LIVE_EVENTS = [
  'order:new',
  'order:status_changed',
  'order:assigned',
  'order:reassigned',
  'order:assigned_bulk',
  'order:assignments_changed',
  'order:callback_due',
  'cs:duplicates_changed',
  'cart:updated',
  'order:claim_available',
] as const;

export const meta: MetaFunction = () => [
  { title: 'Live Activities — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'cs.teamOverview');
  const cookie = getSessionCookie(request);
  const canCreateOffline = true;
  const canDeleteCart = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'HEAD_OF_CS';
  let productsForOfflineOrder: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> = [];
  {
    const productsRes = await apiRequest<{ result?: { data?: { products: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> } } }>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    );
    if (productsRes.ok && productsRes.data?.result?.data?.products) {
      productsForOfflineOrder = productsRes.data.result.data.products;
    }
  }

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';
  const fromParamEarly = url.searchParams.get('from');
  const hotSwapFromParamEarly =
    url.searchParams.get('hotSwapFrom')?.trim() || fromParamEarly?.trim() || undefined;

  // Fetch dispatch mode to know if claim mode is active
  const dispatchSettingRes = await apiRequest<unknown>(
    `/trpc/settings.getSystemSettings`,
    { method: 'GET', cookie },
  );
  const settingsData = (dispatchSettingRes.data as { result?: { data?: Array<{ key: string; value: Record<string, unknown> }> } })?.result?.data ?? [];
  const dispatchSetting = settingsData.find((s) => s.key === 'CS_DISPATCH_STRATEGY');
  const isClaimMode = dispatchSetting?.value?.strategy === 'claim';
  const claimCapSetting = settingsData.find((s) => s.key === 'CS_CLAIM_CAP');
  const claimCap = typeof claimCapSetting?.value?.cap === 'number' ? claimCapSetting.value.cap : 2;

  const hotSwapFromForLoader = hotSwapFromParamEarly;
  const hotSwapListInput = hotSwapFromForLoader
    ? {
        assignedCsId: hotSwapFromForLoader,
        statuses: ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const,
        limit: 100,
        page: 1,
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
      }
    : null;
  const hotSwapOrdersP = hotSwapListInput
    ? apiRequest<unknown>(
        `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(hotSwapListInput))}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false as const, data: {} });

  // ── Critical data: await these so the page always has core content ──
  const [
    workloadsRes,
    unassignedRes,
    statusCountsRes,
    activeOrdersRes,
    activityRes,
    pendingRes,
    abandonedRes,
    hotSwapOrdersRes,
  ] = await Promise.all([
    apiRequest<unknown>('/trpc/orders.csWorkloads', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'UNPROCESSED', limit: 20 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(JSON.stringify(defaultTodayRange()))}`, { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'CS_ENGAGED', limit: 20, ...defaultTodayRange() }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/cart.listActivity?input=${encodeURIComponent(JSON.stringify({ limit: 60 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/cart.listPending?input=${encodeURIComponent(JSON.stringify({ limit: 30 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/cart.listAbandoned?input=${encodeURIComponent(JSON.stringify({ limit: 50 }))}`,
      { method: 'GET', cookie },
    ),
    hotSwapOrdersP,
  ]);

  const workloads = workloadsRes.ok
    ? (workloadsRes.data as { result?: { data?: AgentWorkload[] } })?.result?.data ?? []
    : [];
  const unassignedData = unassignedRes.ok
    ? (unassignedRes.data as { result?: { data?: { orders: CSOrder[]; pagination: { total: number } } } })?.result?.data
    : null;
  const activeData = activeOrdersRes.ok
    ? (activeOrdersRes.data as { result?: { data?: { orders: CSOrder[]; pagination: { total: number } } } })?.result?.data
    : null;
  const statusCounts = statusCountsRes.ok
    ? (statusCountsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};
  const activityItems = activityRes.ok
    ? (activityRes.data as { result?: { data?: LiveActivityItem[] } })?.result?.data ?? []
    : [];
  const pendingCarts = pendingRes.ok
    ? (pendingRes.data as { result?: { data?: PendingCart[] } })?.result?.data ?? []
    : [];
  const abandonedCarts = abandonedRes.ok
    ? (abandonedRes.data as { result?: { data?: PendingCart[] } })?.result?.data ?? []
    : [];

  let hotSwapOrdersPayload: { forAgentId: string; orders: CSOrder[]; total: number } | null = null;
  if (hotSwapFromForLoader && hotSwapOrdersRes.ok) {
    const pack = (hotSwapOrdersRes.data as { result?: { data?: { orders: CSOrder[]; pagination: { total: number } } } })
      ?.result?.data;
    if (pack) {
      hotSwapOrdersPayload = {
        forAgentId: hotSwapFromForLoader,
        orders: pack.orders ?? [],
        total: pack.pagination?.total ?? 0,
      };
    }
  }

  const criticalData = {
    workloads,
    unassignedOrders: unassignedData?.orders ?? [],
    unassignedTotal: unassignedData?.pagination?.total ?? 0,
    activeOrders: activeData?.orders ?? [],
    activeTotal: activeData?.pagination?.total ?? 0,
    hotSwapOrdersPayload,
    statusCounts,
    isClaimMode,
    claimCap,
    initialCartActivity: {
      activityItems,
      pendingCarts,
      abandonedCarts,
    },
  };

  // ── Non-critical: deferred (stream to client) ──────────────
  const inactiveAgents: Promise<InactiveAgent[]> = apiRequest<unknown>(
    `/trpc/orders.inactiveAgents?input=${encodeURIComponent(JSON.stringify({ thresholdMinutes: 10 }))}`,
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: InactiveAgent[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  const callbackOrders: Promise<CSOrder[]> = apiRequest<unknown>(
    '/trpc/orders.scheduledCallbacks',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: CSOrder[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  const flaggedDuplicates: Promise<DuplicatePair[]> = apiRequest<unknown>(
    '/trpc/orders.flaggedDuplicates',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok
      ? (res.data as { result?: { data?: Array<{ duplicate: CSOrder; original: CSOrder | null }> } })?.result?.data ?? []
      : [],
  ).catch(() => []);

  const leaderboard: Promise<CSLeaderboardEntry[]> = apiRequest<unknown>(
    `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: CSLeaderboardEntry[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  // Claim queue — deferred, only relevant in claim mode
  const claimQueue: Promise<CSOrder[]> = isClaimMode
    ? apiRequest<unknown>('/trpc/orders.claimQueue', { method: 'GET', cookie })
        .then((res) =>
          res.ok ? (res.data as { result?: { data?: CSOrder[] } })?.result?.data ?? [] : [],
        )
        .catch(() => [])
    : Promise.resolve([]);

  const cartStats: Promise<{ pending: number; abandonedLast24h: number }> = apiRequest<unknown>(
    '/trpc/cart.getStats?input=%7B%7D',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok
      ? (res.data as { result?: { data?: { pending: number; abandonedLast24h: number } } })?.result?.data ?? { pending: 0, abandonedLast24h: 0 }
      : { pending: 0, abandonedLast24h: 0 },
  ).catch(() => ({ pending: 0, abandonedLast24h: 0 }));

  return {
    criticalData,
    inactiveAgents,
    callbackOrders,
    flaggedDuplicates,
    leaderboard,
    leaderboardPeriod,
    cartStats,
    claimQueue,
    canCreateOffline,
    canDeleteCart,
    productsForOfflineOrder,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'assign') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const csAgentId = formData.get('csAgentId')?.toString() ?? '';
    const branchId = branchIdFromForm(formData);

    if (!orderId || !csAgentId) {
      return json({ error: 'Order and closer selection are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.assignToCS', {
      method: 'POST',
      cookie,
      body: { orderId, csAgentId, ...(branchId ? { branchId } : {}) },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Assignment failed') }, { status: safeStatus(res.status) });
    }

    return json({ success: true });
  }

  if (intent === 'bulkAssignToCS') {
    // Multi-select bulk-assign from the Unassigned Queue tab. Posts the same backend
    // mutation as `assign` but for an arbitrary list of order IDs.
    const orderIdsRaw = formData.get('orderIds')?.toString() ?? '[]';
    const csAgentId = formData.get('csAgentId')?.toString() ?? '';

    let orderIds: string[];
    try {
      orderIds = JSON.parse(orderIdsRaw) as string[];
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return json({ error: 'Pick at least one order' }, { status: 400 });
    }
    if (!csAgentId) {
      return json({ error: 'Pick a closer to assign to' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);

    const res = await apiRequest<unknown>('/trpc/orders.bulkAssignToCS', {
      method: 'POST',
      cookie,
      body: { orderIds, csAgentId, ...(branchId ? { branchId } : {}) },
      timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Bulk assignment failed') }, { status: safeStatus(res.status) });
    }
    const data = res.data as { result?: { data?: { assigned?: number } } };
    return json({ success: true, assigned: data?.result?.data?.assigned ?? orderIds.length });
  }

  if (intent === 'bulkReassign') {
    const orderIdsRaw = formData.get('orderIds')?.toString() ?? '[]';
    const fromAgentId = formData.get('fromAgentId')?.toString() ?? '';
    const toAgentId = formData.get('toAgentId')?.toString() ?? '';

    let orderIds: string[];
    try {
      orderIds = JSON.parse(orderIdsRaw) as string[];
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }

    if (orderIds.length === 0 || !fromAgentId || !toAgentId) {
      return json({ error: 'Must select orders and both closers' }, { status: 400 });
    }

    if (fromAgentId === toAgentId) {
      return json({ error: 'Cannot reassign to the same closer' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);

    const res = await apiRequest<unknown>('/trpc/orders.bulkReassign', {
      method: 'POST',
      cookie,
      body: { orderIds, fromAgentId, toAgentId, ...(branchId ? { branchId } : {}) },
      timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Reassignment failed') }, { status: safeStatus(res.status) });
    }

    return json({ success: true });
  }

  if (intent === 'redistribute') {
    const branchId = branchIdFromForm(formData);
    const res = await apiRequest<{ result?: { data?: { distributed: number } } }>(
      '/trpc/orders.distributeUnassignedOrders',
      { method: 'POST', cookie, body: branchId ? { branchId } : {} },
    );

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Distribute order failed') }, { status: safeStatus(res.status) });
    }

    const distributed = res.data?.result?.data?.distributed ?? 0;
    return json({ success: true, distributed });
  }

  if (intent === 'scheduleCallback') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const delayMinutes = parseInt(formData.get('delayMinutes')?.toString() ?? '120', 10);
    const notes = formData.get('notes')?.toString() || undefined;

    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);

    const res = await apiRequest<unknown>('/trpc/orders.scheduleCallback', {
      method: 'POST',
      cookie,
      body: { orderId, delayMinutes, notes, ...(branchId ? { branchId } : {}) },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to schedule callback') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'mergeDuplicate') {
    const duplicateId = formData.get('duplicateId')?.toString() ?? '';
    const originalId = formData.get('originalId')?.toString() ?? '';

    if (!duplicateId || !originalId) {
      return json({ error: 'Both order IDs required' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);

    const res = await apiRequest<unknown>('/trpc/orders.mergeDuplicate', {
      method: 'POST',
      cookie,
      body: { duplicateId, originalId, ...(branchId ? { branchId } : {}) },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to merge orders') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dismissDuplicate') {
    const orderId = formData.get('orderId')?.toString() ?? '';

    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);

    const res = await apiRequest<unknown>('/trpc/orders.dismissDuplicate', {
      method: 'POST',
      cookie,
      body: { orderId, ...(branchId ? { branchId } : {}) },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to dismiss duplicate') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'createOffline') {
    await requirePermission(request, 'cs.teamOverview');
    const customerName = formData.get('customerName')?.toString()?.trim() ?? '';
    const customerPhone = formData.get('customerPhone')?.toString()?.trim() ?? '';
    const itemsRaw = formData.get('items')?.toString() ?? '[]';
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
    const paymentMethod = (formData.get('paymentMethod') as string) === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY';
    const customerEmail = formData.get('customerEmail')?.toString()?.trim();
    if (paymentMethod === 'PAY_ONLINE' && (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
      return json({ error: 'Valid email is required for Pay online' }, { status: 400 });
    }
    const branchId = branchIdFromForm(formData);
    const res = await apiRequest<{ result?: { data?: { id: string } } }>('/trpc/orders.createOffline', {
      method: 'POST',
      cookie,
      body: {
        customerName,
        customerPhone,
        customerAddress: formData.get('customerAddress')?.toString()?.trim() || undefined,
        deliveryAddress: formData.get('deliveryAddress')?.toString()?.trim() || undefined,
        deliveryNotes: formData.get('deliveryNotes')?.toString()?.trim() || undefined,
        deliveryState: formData.get('deliveryState')?.toString()?.trim() || undefined,
        customerGender: (formData.get('customerGender') as string) || undefined,
        preferredDeliveryDate: formData.get('preferredDeliveryDate')?.toString()?.trim() || undefined,
        paymentMethod,
        customerEmail: paymentMethod === 'PAY_ONLINE' ? customerEmail : undefined,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, offerLabel: i.offerLabel })),
        totalAmount: parseFloat((formData.get('totalAmount') as string) || '0') || undefined,
        ...(branchId ? { branchId } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create offline order') }, { status: safeStatus(res.status) });
    }
    const orderId = res.data?.result?.data?.id;
    return json({ success: true, orderId });
  }

  if (intent === 'claimOrder') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }
    const branchId = branchIdFromForm(formData);
    const res = await apiRequest<unknown>('/trpc/orders.claimOrder', {
      method: 'POST',
      cookie,
      body: { orderId, ...(branchId ? { branchId } : {}) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to claim order') }, { status: safeStatus(res.status) });
    }
    const data = res.data as { result?: { data?: { success: boolean; message?: string } } };
    const result = data?.result?.data;
    if (!result?.success) {
      return json({ error: result?.message ?? 'Order already claimed' }, { status: 409 });
    }
    return json({ success: true, message: 'Order claimed' });
  }

  if (intent === 'transition') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const newStatus = formData.get('newStatus')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() || undefined;

    if (!orderId || !newStatus) {
      return json({ error: 'Order ID and new status are required' }, { status: 400 });
    }

    const branchId = branchIdFromForm(formData);
    const body: {
      orderId: string;
      newStatus: string;
      metadata?: { reason: string };
      branchId?: string;
    } = {
      orderId,
      newStatus,
    };
    if (reason) body.metadata = { reason };
    if (branchId) body.branchId = branchId;

    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Transition failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CSQueueRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...CS_QUEUE_LIVE_EVENTS]);
  return (
    <>
    <CSDashboardPage
      {...data.criticalData}
      liveEvents={[...CS_QUEUE_LIVE_EVENTS]}
      inactiveAgents={data.inactiveAgents}
      callbackOrders={data.callbackOrders}
      flaggedDuplicates={data.flaggedDuplicates}
      leaderboard={data.leaderboard}
      leaderboardPeriod={data.leaderboardPeriod as 'this_month' | 'all_time'}
      cartStats={data.cartStats}
      claimQueue={data.claimQueue}
      canCreateOffline={data.canCreateOffline}
      canDeleteCart={data.canDeleteCart}
      productsForOfflineOrder={data.productsForOfflineOrder}
    />
    </>
  );
}
