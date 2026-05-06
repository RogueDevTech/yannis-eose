import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, requirePermissionOrRoles, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { LogisticsOrdersPage, type LogisticsOrderRow } from '~/features/logistics/LogisticsOrdersPage';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;
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

const defaultThisMonth = defaultThisMonthRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
  const cookie = getSessionCookie(request);

  const isTplManager = user.role === 'TPL_MANAGER';
  const effectiveLogisticsLocationId =
    isTplManager && user.logisticsLocationId ? user.logisticsLocationId : undefined;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || 'CONFIRMED';
  const search = url.searchParams.get('search') || undefined;
  const scopedStatuses = status === 'ALL' ? [...LOGISTICS_STATUS_SCOPE] : undefined;

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
    ...(scopedStatuses ? { statuses: scopedStatuses } : {}),
    search: search || undefined,
    sortBy: 'preferredDeliveryDate' as const,
    sortOrder: 'asc' as const,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(useLocationFilter && { logisticsLocationId: effectiveLogisticsLocationId }),
  };
  const countsInput: {
    startDate?: string;
    endDate?: string;
    logisticsLocationId?: string;
    statuses?: readonly string[];
  } = {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;
  if (useLocationFilter) countsInput.logisticsLocationId = effectiveLogisticsLocationId;
  if (scopedStatuses) countsInput.statuses = scopedStatuses;

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
  const locationProviderById = new Map(locations.map((l) => [l.id, l.providerName ?? null]));
  const riderById = new Map(ridersData.map((r) => [r.id, r]));

  const enrichedOrders = orders.map((o: Record<string, unknown>) => ({
    ...o,
    locationName: o.logisticsLocationId ? locationNameById.get(o.logisticsLocationId as string) ?? '—' : '—',
    locationProviderName: o.logisticsLocationId ? locationProviderById.get(o.logisticsLocationId as string) ?? null : null,
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
    pageDescription:
      'Use View to open an order at your hub, or Resolve order on a confirmed row for the fast path (delivery date, receipt, and handoff).',
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
        newStatus: 'AGENT_ASSIGNED',
        metadata: { logisticsLocationId },
      },
    });
    if (!res.ok) {
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Allocation failed') }, { status: safeStatus(res.status) });
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
        results.push({ orderId, success: false, error: extractApiErrorMessage(res.data, 'Dispatch failed') });
      }
    }
    return json({ success: true, succeeded, failed, results });
  }

  if (intent === 'bulkMarkDelivered') {
    const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
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
    const canTransitionDirect = user.role === 'HEAD_OF_LOGISTICS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
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
          results.push({ orderId, success: false, error: extractApiErrorMessage(res.data, 'Submit failed') });
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
          results.push({ orderId, success: false, error: extractApiErrorMessage(res.data, 'Mark delivered failed') });
        }
      }
    }
    return json({ success: true, succeeded, failed, results });
  }

  if (intent === 'transition') {
    const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
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
    const canTransitionDirect = user.role === 'HEAD_OF_LOGISTICS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

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
        return json({ success: false, error: extractApiErrorMessage(res.data, 'Submit failed') }, { status: safeStatus(res.status) });
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
      return json({ success: false, error: extractApiErrorMessage(res.data, 'Transition failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateDeliveryDate') {
    const user = await requirePermissionOrRoles(request, {
      roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'],
      permission: 'logistics.read',
    }) as { id: string; role: string; logisticsLocationId?: string | null };
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
    const updateRes = await apiRequest<{
      result?: { data?: { status: string; logisticsLocationId?: string | null; riderId?: string | null } };
    }>('/trpc/orders.update', { method: 'POST', cookie, body });
    if (!updateRes.ok) {
      return json({ success: false, error: extractApiErrorMessage(updateRes.data, 'Update failed'), intent: 'updateDeliveryDate' }, { status: safeStatus(updateRes.status) });
    }
    type OrderSnapshot = { status?: string; logisticsLocationId?: string | null; riderId?: string | null };
    let current: OrderSnapshot | undefined = updateRes.data?.result?.data;
    let status = current?.status;
    const terminal = ['DELIVERED', 'REMITTED', 'RETURNED', 'RESTOCKED', 'WRITTEN_OFF', 'CANCELLED'];
    if (status && terminal.includes(status)) {
      return json({ success: true, intent: 'updateDeliveryDate' });
    }
    const deliveryMetadata: Record<string, unknown> = { deliveryProofUrl: resolveReceiptUrl };
    if (body.deliveryFeeAddOn != null) deliveryMetadata.deliveryFeeAddOn = body.deliveryFeeAddOn;
    if (body.deliveryDiscountAmount != null) deliveryMetadata.deliveryDiscountAmount = body.deliveryDiscountAmount;

    const transitionResponse = async (res: { ok: boolean; status: number; data: unknown }): Promise<OrderSnapshot | undefined> => {
      if (!res.ok) return undefined;
      const data = (res.data as { result?: { data?: OrderSnapshot } })?.result?.data;
      return data ?? undefined;
    };
    const transitionError = (res: { data: unknown }, fallback: string): string =>
      extractApiErrorMessage(res.data, fallback);

    while (status && status !== 'DELIVERED') {
      if (status === 'CONFIRMED') {
        const locationId = user.logisticsLocationId ?? current?.logisticsLocationId;
        if (!locationId) {
          return json(
            { success: false, error: 'Resolve from CONFIRMED requires a TPL location. Allocate the order from the order detail page first.', intent: 'updateDeliveryDate' },
            { status: 400 },
          );
        }
        const tr = await apiRequest<{ result?: { data?: OrderSnapshot } }>('/trpc/orders.transition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'AGENT_ASSIGNED', metadata: { logisticsLocationId: locationId } },
        });
        if (!tr.ok) {
          const errMsg = transitionError(tr, 'Allocation failed');
          return json({ success: false, error: errMsg, intent: 'updateDeliveryDate' }, { status: safeStatus(tr.status) });
        }
        current = await transitionResponse(tr);
        status = current?.status;
        continue;
      }
      if (status === 'AGENT_ASSIGNED') {
        let riderId = current?.riderId;
        if (!riderId) {
          const ridersRes = await apiRequest<{ result?: { data?: Array<{ id: string; logisticsLocationId: string | null }> } }>(
            '/trpc/logistics.listRiders?input=%7B%7D',
            { method: 'GET', cookie },
          );
          if (!ridersRes.ok) {
            return json({ success: false, error: 'Could not load riders', intent: 'updateDeliveryDate' }, { status: 502 });
          }
          const riders = (ridersRes.data as { result?: { data?: Array<{ id: string; logisticsLocationId: string | null }> } })?.result?.data ?? [];
          const locationId = current?.logisticsLocationId;
          const rider = locationId ? riders.find((r) => r.logisticsLocationId === locationId) : riders[0];
          if (!rider) {
            return json({ success: false, error: 'No riders at this location. Add a rider before resolving.', intent: 'updateDeliveryDate' }, { status: 400 });
          }
          riderId = rider.id;
        }
        const tr = await apiRequest<{ result?: { data?: OrderSnapshot } }>('/trpc/orders.transition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'DISPATCHED', metadata: { riderId } },
        });
        if (!tr.ok) {
          return json({ success: false, error: transitionError(tr, 'Dispatch failed'), intent: 'updateDeliveryDate' }, { status: safeStatus(tr.status) });
        }
        current = await transitionResponse(tr);
        status = current?.status;
        continue;
      }
      if (status === 'DISPATCHED') {
        const tr = await apiRequest<{ result?: { data?: OrderSnapshot } }>('/trpc/orders.transition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'IN_TRANSIT' },
        });
        if (!tr.ok) {
          return json({ success: false, error: transitionError(tr, 'Mark in transit failed'), intent: 'updateDeliveryDate' }, { status: safeStatus(tr.status) });
        }
        current = await transitionResponse(tr);
        status = current?.status;
        continue;
      }
      if (status === 'IN_TRANSIT') {
        const tr = await apiRequest<{ result?: { data?: OrderSnapshot } }>('/trpc/orders.transition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'DELIVERED', metadata: deliveryMetadata },
        });
        if (!tr.ok) {
          return json({ success: false, error: transitionError(tr, 'Mark delivered failed'), intent: 'updateDeliveryDate' }, { status: safeStatus(tr.status) });
        }
        return json({ success: true, intent: 'updateDeliveryDate' });
      }
      return json({ success: false, error: `Cannot resolve order from status: ${status}`, intent: 'updateDeliveryDate' }, { status: 400 });
    }
    return json({ success: true, intent: 'updateDeliveryDate' });
  }

  return json({ success: false, error: 'Unknown action' }, { status: 400 });
}

export default function TplOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return (
    <>
      <LogisticsOrdersPage {...data} orders={data.orders as LogisticsOrderRow[]} />
    </>
  );
}
