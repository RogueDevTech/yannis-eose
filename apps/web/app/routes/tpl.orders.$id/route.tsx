import { useMemo, Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { LogisticsOrderDetailPage } from '~/features/logistics/LogisticsOrderDetailPage';
import type { OrderDetail, HistoryEntry } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';
import { OrderDetailSkeleton } from '~/features/orders/OrderDetailSkeleton';

export const meta: MetaFunction = () => [
  { title: 'Order — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const orderId = params['id'];
  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }

  const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
  const cookie = getSessionCookie(request);

  type RichAllocatableLocation = {
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink?: string | null;
    providerName: string | null;
    providerKind?: string | null;
    eligible: boolean;
    reason: string | null;
    availabilityByProduct: Array<{
      productId: string;
      productName: string;
      needed: number;
      available: number;
    }> | null;
  };

  const emptyReturn = {
    order: null as OrderDetail | null,
    history: Promise.resolve([]) as Promise<HistoryEntry[]>,
    locations: [] as Location[],
    riders: [] as Array<{ id: string; name: string; logisticsLocationId: string | null }>,
    allocatableLocations: [] as Location[],
    richAllocatableLocations: [] as RichAllocatableLocation[],
  };

  const pageData = (async () => {
    const [orderRes, locationsRes, ridersRes, allocatableRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20, status: 'ACTIVE' }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/logistics.listRiders?input=%7B%7D', { method: 'GET', cookie }),
      apiRequest<unknown>(
        `/trpc/orders.listAllocatableLocations?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        { method: 'GET', cookie },
      ).catch(() => ({ ok: false, status: 503, data: {} as unknown })),
    ]);

    if (!orderRes.ok) {
      return emptyReturn;
    }

    const trpcData = orderRes.data as { result?: { data?: OrderDetail } };
    const order = trpcData?.result?.data ?? null;
    if (!order) {
      return emptyReturn;
    }

    if (user.role === 'TPL_MANAGER' && user.logisticsLocationId) {
      const atMyLocation = order.logisticsLocationId === user.logisticsLocationId;
      const unallocatedConfirmed = order.status === 'CONFIRMED' && !order.logisticsLocationId;
      if (!atMyLocation && !unallocatedConfirmed) {
        return emptyReturn;
      }
    }

    const locationsData = locationsRes.ok
      ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
      : null;
    const ridersData = ridersRes.ok
      ? (ridersRes.data as { result?: { data?: Array<{ id: string; name: string; logisticsLocationId: string | null }> } })?.result?.data ?? []
      : [];

    const historyRows: HistoryEntry[] = await apiRequest<unknown>(
      `/trpc/audit.recordHistory?input=${encodeURIComponent(JSON.stringify({ tableName: 'orders', recordId: orderId, page: 1, limit: 20 }))}`,
      { method: 'GET', cookie },
    )
      .then((historyRes) => {
        if (!historyRes.ok) return [];
        const historyData = historyRes.data as { result?: { data?: { rows: HistoryEntry[] } } };
        return historyData?.result?.data?.rows ?? [];
      })
      .catch(() => [] as HistoryEntry[]);

    const locations = locationsData?.locations ?? [];
    const allocatableLocations =
      user.role === 'TPL_MANAGER' && user.logisticsLocationId
        ? locations.filter((l) => l.id === user.logisticsLocationId)
        : locations;

    const allocatableRich: RichAllocatableLocation[] = allocatableRes.ok
      ? ((allocatableRes.data as { result?: { data?: Array<RichAllocatableLocation & { providerName?: string | null }> } })?.result?.data ?? []).map(
          (loc) => ({ ...loc, providerName: loc.providerName ?? null }),
        )
      : [];
    const richAllocatableLocations =
      user.role === 'TPL_MANAGER' && user.logisticsLocationId
        ? allocatableRich.filter((l) => l.id === user.logisticsLocationId)
        : allocatableRich;

    return {
      order,
      history: Promise.resolve(historyRows) as Promise<HistoryEntry[]>,
      locations,
      riders: ridersData,
      allocatableLocations,
      richAllocatableLocations,
    };
  })();

  return defer({ pageData });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const orderId = params['id'];

  if (!orderId) {
    return json({ error: 'Order ID required' }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (intent === 'allocate') {
    await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString();
    if (!logisticsLocationId) {
      return json({ error: 'Location is required' }, { status: 400 });
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
      return json({ error: extractApiErrorMessage(res.data, 'Allocation failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dispatch') {
    await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'logistics.read' });
    const riderId = formData.get('riderId')?.toString();
    if (!riderId) {
      return json({ error: 'Rider is required' }, { status: 400 });
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
      return json({ error: extractApiErrorMessage(res.data, 'Dispatch failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'transition') {
    const newStatus = (formData.get('newStatus')?.toString() ?? '').trim();
    if (!newStatus) {
      return json({ error: 'Status is required' }, { status: 400 });
    }
    const reason = formData.get('reason')?.toString() || undefined;
    const deliveredQtyStr = formData.get('deliveredQuantity')?.toString();
    const returnedQtyStr = formData.get('returnedQuantity')?.toString();
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    const deliveryProofUrl = formData.get('deliveryProofUrl')?.toString()?.trim() || undefined;
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();

    const metadata: Record<string, unknown> = {};
    if (reason) metadata['reason'] = reason;
    const deliveredQty = deliveredQtyStr != null ? parseInt(deliveredQtyStr, 10) : NaN;
    if (!Number.isNaN(deliveredQty) && Number.isInteger(deliveredQty) && deliveredQty >= 0) {
      metadata['deliveredQuantity'] = deliveredQty;
    }
    const returnedQty = returnedQtyStr != null ? parseInt(returnedQtyStr, 10) : NaN;
    if (!Number.isNaN(returnedQty) && Number.isInteger(returnedQty) && returnedQty >= 0) {
      metadata['returnedQuantity'] = returnedQty;
    }
    if (deliveryFeeAddOnStr !== undefined && deliveryFeeAddOnStr !== '') {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata['deliveryFeeAddOn'] = addOn;
    }
    if (deliveryProofUrl) metadata['deliveryProofUrl'] = deliveryProofUrl;
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) metadata['deliveryDiscountAmount'] = discount;
    }

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
        return json({ error: extractApiErrorMessage(res.data, 'Submit failed') }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
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
      return json({ error: extractApiErrorMessage(res.data, 'Transition failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

const ORDER_DETAIL_EVENTS = ['order:status_changed'] as const;

export default function TplOrderDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  const orderEvents = useMemo(() => [...ORDER_DETAIL_EVENTS], []);
  usePageRefreshOnEvent(orderEvents);

  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <Await resolve={pageData}>
        {({ order, history, locations, riders, allocatableLocations, richAllocatableLocations }) => {
          if (!order) {
            return (
              <div className="card text-center py-12">
                <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
                <h2 className="text-xl font-bold text-app-fg">Order not found</h2>
                <p className="mt-2 text-sm text-app-fg-muted">
                  The order you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
                </p>
                <a href="/tpl/orders" className="btn-primary mt-4 inline-block">
                  Back to Orders
                </a>
              </div>
            );
          }

          return (
            <LogisticsOrderDetailPage
              order={order as OrderDetail}
              history={history as Promise<HistoryEntry[]>}
              locations={locations as Location[]}
              riders={riders as Array<{ id: string; name: string; logisticsLocationId: string | null }>}
              backLink="/tpl/orders"
              backLabel="Orders"
              allocatableLocations={allocatableLocations.length > 0 ? (allocatableLocations as Location[]) : undefined}
              richAllocatableLocations={richAllocatableLocations.length > 0 ? richAllocatableLocations : undefined}
            />
          );
        }}
      </Await>
    </Suspense>
  );
}
