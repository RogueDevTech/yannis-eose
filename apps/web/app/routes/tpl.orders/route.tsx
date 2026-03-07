import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import * as fs from 'node:fs';
import { apiRequest, getSessionCookie, requirePermission, requirePermissionOrRoles, safeStatus, defaultThisMonthRange } from '~/lib/api.server';

const DEBUG_LOG_PATH = '/Users/Apple/Desktop/PROJECTS/ROGUE-DEVTECH/yannis-eose/.cursor/debug-c05241.log';
function debugLog(msg: string, data: Record<string, unknown>, hypothesisId: string) {
  const line = JSON.stringify({ sessionId: 'c05241', location: 'tpl.orders/route.tsx', message: msg, data, timestamp: Date.now(), hypothesisId }) + '\n';
  try { fs.appendFileSync(DEBUG_LOG_PATH, line); } catch { /* ignore */ }
}
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
    allocationOnDetailOnly: true,
    canEditDeliveryDate: true,
    markInTransitLabel: 'Mark In Transit',
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

  if (intent === 'bulkMarkDelivered') {
    const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN'], permission: 'logistics.read' });
    let orderIds: string[] = [];
    try {
      const raw = formData.get('orderIds')?.toString();
      if (raw) orderIds = JSON.parse(raw) as string[];
    } catch {
      return json({ success: false, error: 'Invalid order IDs', succeeded: 0, failed: 0, results: [] }, { status: 400 });
    }
    if (!orderIds.length) {
      return json({ success: false, error: 'Select at least one order', succeeded: 0, failed: orderIds.length, results: [] }, { status: 400 });
    }
    const isDeliveryConfirmation = true;
    const canTransitionDirect = user.role === 'HEAD_OF_LOGISTICS' || user.role === 'SUPER_ADMIN';
    const results: Array<{ orderId: string; success: boolean; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;
    for (const orderId of orderIds) {
      if (isDeliveryConfirmation && !canTransitionDirect) {
        const res = await apiRequest<unknown>('/trpc/logistics.submitDeliveryConfirmation', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'DELIVERED' },
        });
        if (res.ok) {
          succeeded++;
          results.push({ orderId, success: true });
        } else {
          failed++;
          const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Submit failed';
          results.push({ orderId, success: false, error: err });
        }
      } else {
        const res = await apiRequest<unknown>('/trpc/orders.transition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'DELIVERED' },
        });
        if (res.ok) {
          succeeded++;
          results.push({ orderId, success: true });
        } else {
          failed++;
          const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Mark delivered failed';
          results.push({ orderId, success: false, error: err });
        }
      }
    }
    return json({ success: true, succeeded, failed, results });
  }

  if (intent === 'transition') {
    const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN'], permission: 'logistics.read' });
    const orderId = formData.get('orderId')?.toString();
    const newStatus = formData.get('newStatus')?.toString()?.trim();
    if (!orderId || !newStatus) {
      return json({ success: false, error: 'Order and status are required' }, { status: 400 });
    }

    const reason = formData.get('reason')?.toString() || undefined;
    const metadata: Record<string, unknown> = {};
    if (reason) metadata['reason'] = reason;
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    if (deliveryFeeAddOnStr !== undefined && deliveryFeeAddOnStr !== '') {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata['deliveryFeeAddOn'] = addOn;
    }
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) metadata['deliveryDiscountAmount'] = discount;
    }

    // Delivery confirmation (DELIVERED / PARTIALLY_DELIVERED): TPL_MANAGER goes through approval
    const isDeliveryConfirmation = newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED';
    const canTransitionDirect = user.role === 'HEAD_OF_LOGISTICS' || user.role === 'SUPER_ADMIN';

    if (isDeliveryConfirmation && !canTransitionDirect) {
      const res = await apiRequest<unknown>('/trpc/logistics.submitDeliveryConfirmation', {
        method: 'POST',
        cookie,
        body: {
          orderId,
          newStatus,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        },
      });
      if (!res.ok) {
        const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Submit failed';
        return json({ success: false, error: err }, { status: safeStatus(res.status) });
      }
      return json({ success: true, deliveryConfirmation: true });
    }

    // Direct transition (e.g. DISPATCHED → IN_TRANSIT, or SUPER_ADMIN marking delivered)
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

  if (intent === 'updateDeliveryDate') {
    // #region agent log
    debugLog('updateDeliveryDate intent', { intent: intent ?? null }, 'entry');
    // #endregion
    await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN'], permission: 'logistics.read' });
    const orderId = formData.get('orderId')?.toString();
    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString()?.trim();
    const resolveReceiptUrl = formData.get('resolveReceiptUrl')?.toString()?.trim();
    if (!orderId) {
      return json({ success: false, error: 'Order is required' }, { status: 400 });
    }
    if (!preferredDeliveryDate || preferredDeliveryDate.length > 100) {
      return json({ success: false, error: 'Valid delivery date is required' }, { status: 400 });
    }
    if (!resolveReceiptUrl || !resolveReceiptUrl.startsWith('http')) {
      return json({ success: false, error: 'Receipt upload is required' }, { status: 400 });
    }
    const body: { orderId: string; preferredDeliveryDate: string; resolveReceiptUrl: string; deliveryFeeAddOn?: number; deliveryDiscountAmount?: number } = {
      orderId,
      preferredDeliveryDate,
      resolveReceiptUrl,
    };
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    if (deliveryFeeAddOnStr !== undefined && deliveryFeeAddOnStr !== '') {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) body.deliveryFeeAddOn = addOn;
    }
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) body.deliveryDiscountAmount = discount;
    }
    const res = await apiRequest<{ result?: { data?: { status: string } } }>('/trpc/orders.update', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Update failed';
      debugLog('orders.update failed', { orderId, resStatus: res.status, error: err }, 'updateFailed');
      return json({ success: false, error: err }, { status: safeStatus(res.status) });
    }
    // Resolve order: transition to DELIVERED then COMPLETED so the order is always marked delivered and completed.
    // If DISPATCHED, first transition to IN_TRANSIT; if already IN_TRANSIT, go straight to DELIVERED.
    const updatedOrder = res.data?.result?.data;
    const status = updatedOrder?.status;

    // #region agent log
    debugLog('After orders.update', { orderId, hasResultData: !!res.data?.result?.data, status, statusType: typeof status, rawResultKeys: res.data ? Object.keys(res.data as object) : [] }, 'A');
    // #endregion

    if (status === 'DISPATCHED') {
      const inTransitRes = await apiRequest<unknown>('/trpc/orders.transition', {
        method: 'POST',
        cookie,
        body: { orderId, newStatus: 'IN_TRANSIT' },
      });
      // #region agent log
      debugLog('IN_TRANSIT transition', { orderId, ok: inTransitRes.ok, status: inTransitRes.status }, 'B');
      // #endregion
      if (!inTransitRes.ok) {
        const err = (inTransitRes.data as { error?: { message?: string } })?.error?.message ?? 'Mark in transit failed';
        return json({ success: false, error: err }, { status: safeStatus(inTransitRes.status) });
      }
    }

    if (status === 'DISPATCHED' || status === 'IN_TRANSIT') {
      const transitionRes = await apiRequest<unknown>('/trpc/orders.transition', {
        method: 'POST',
        cookie,
        body: {
          orderId,
          newStatus: 'DELIVERED',
          metadata: { deliveryProofUrl: resolveReceiptUrl },
        },
      });
      // #region agent log
      debugLog('DELIVERED transition', { orderId, ok: transitionRes.ok, status: transitionRes.status }, 'C');
      // #endregion
      if (!transitionRes.ok) {
        const err = (transitionRes.data as { error?: { message?: string } })?.error?.message ?? 'Mark delivered failed';
        return json({ success: false, error: err }, { status: safeStatus(transitionRes.status) });
      }
      const completedRes = await apiRequest<unknown>('/trpc/orders.transition', {
        method: 'POST',
        cookie,
        body: { orderId, newStatus: 'COMPLETED' },
      });
      // #region agent log
      debugLog('COMPLETED transition', { orderId, ok: completedRes.ok, status: completedRes.status }, 'D');
      // #endregion
      if (!completedRes.ok) {
        const err = (completedRes.data as { error?: { message?: string } })?.error?.message ?? 'Mark completed failed';
        return json({ success: false, error: err }, { status: safeStatus(completedRes.status) });
      }
    } else {
      // #region agent log
      debugLog('Skipped DELIVERED block', { orderId, status }, 'E');
      // #endregion
      return json(
        { success: false, error: 'Order must be dispatched or in transit to resolve as delivered. Allocate and dispatch the order first.' },
        { status: 400 },
      );
    }
    return json({ success: true, intent: 'updateDeliveryDate' });
  }

  return json({ success: false, error: 'Unknown action' }, { status: 400 });
}

export default function TplOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <LogisticsOrdersPage {...data} orders={data.orders as LogisticsOrderRow[]} />;
}
