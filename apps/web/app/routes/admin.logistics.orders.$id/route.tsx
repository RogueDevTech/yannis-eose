import { useMemo } from 'react';
import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermission, safeStatus } from '~/lib/api.server';
import { LogisticsOrderDetailPage } from '~/features/logistics/LogisticsOrderDetailPage';
import type { OrderDetail, HistoryEntry } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Logistics Order — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);
  const orderId = params['id'];

  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }

  const [orderRes, locationsRes, ridersRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 20, status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/logistics.listRiders?input=%7B%7D', { method: 'GET', cookie }),
  ]);

  if (!orderRes.ok) {
    return { order: null, history: Promise.resolve([]) as Promise<HistoryEntry[]>, locations: [] as Location[], riders: [] as Array<{ id: string; name: string; logisticsLocationId: string | null }> };
  }

  const trpcData = orderRes.data as { result?: { data?: OrderDetail } };
  const order = trpcData?.result?.data ?? null;
  if (!order) {
    return { order: null, history: Promise.resolve([]) as Promise<HistoryEntry[]>, locations: [] as Location[], riders: [] as Array<{ id: string; name: string; logisticsLocationId: string | null }> };
  }

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
    : null;
  const ridersData = ridersRes.ok
    ? (ridersRes.data as { result?: { data?: Array<{ id: string; name: string; logisticsLocationId: string | null }> } })?.result?.data ?? []
    : [];

  const historyPromise: Promise<HistoryEntry[]> = apiRequest<unknown>(
    `/trpc/audit.recordHistory?input=${encodeURIComponent(JSON.stringify({ tableName: 'orders', recordId: orderId, page: 1, limit: 20 }))}`,
    { method: 'GET', cookie },
  )
    .then((historyRes) => {
      if (!historyRes.ok) return [];
      const historyData = historyRes.data as { result?: { data?: { rows: HistoryEntry[] } } };
      return historyData?.result?.data?.rows ?? [];
    })
    .catch(() => [] as HistoryEntry[]);

  return {
    order,
    history: historyPromise,
    locations: locationsData?.locations ?? [],
    riders: ridersData,
  };
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
    await requirePermission(request, 'logistics.read');
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString();
    if (!logisticsLocationId) {
      return json({ error: 'Location is required' }, { status: 400 });
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
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dispatch') {
    await requirePermission(request, 'logistics.read');
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
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Dispatch failed';
      return json({ error: err }, { status: safeStatus(res.status) });
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
        const errorData = res.data as { error?: { message?: string } };
        const message = errorData?.error?.message ?? 'Submit failed';
        return json({ error: message }, { status: safeStatus(res.status) });
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
      const errorData = res.data as { error?: { message?: string } };
      const message = errorData?.error?.message ?? 'Transition failed';
      return json({ error: message }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

const ORDER_DETAIL_EVENTS = ['order:status_changed'] as const;

export default function LogisticsOrderDetailRoute() {
  const { order, history, locations, riders } = useLoaderData<typeof loader>();
  const orderEvents = useMemo(() => [...ORDER_DETAIL_EVENTS], []);
  usePageRefreshOnEvent(orderEvents);

  if (!order) {
    return (
      <div className="card text-center py-12">
        <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
        <h2 className="text-xl font-bold text-app-fg">Order not found</h2>
        <p className="mt-2 text-sm text-app-fg-muted">
          The order you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
        </p>
        <a href="/admin/logistics/orders" className="btn-primary mt-4 inline-block">
          Back to Logistics Orders
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
    />
  );
}
