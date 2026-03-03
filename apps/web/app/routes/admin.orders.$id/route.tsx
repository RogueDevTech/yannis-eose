import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OrderDetailPage } from '~/features/orders/OrderDetailPage';
import type { CallLogEntry, OrderDetail, OrderDetailStreamData, HistoryEntry } from '~/features/orders/types';

export const meta: MetaFunction = () => [
  { title: 'Order Detail — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['orders.read', 'marketing.orders']);
  const cookie = getSessionCookie(request);
  const orderId = params['id'];

  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }

  const orderDetailPromise = (async (): Promise<OrderDetailStreamData | { notFound: true }> => {
    const [orderRes, strictModeRes, voipRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/settings.isStrictDataMode', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/voip.isEnabled', { method: 'GET', cookie }),
    ]);

    if (!orderRes.ok) return { notFound: true };

    const trpcData = orderRes.data as { result?: { data?: OrderDetail } };
    const order = trpcData?.result?.data;

    if (!order) return { notFound: true };

    const strictData = strictModeRes.data as { result?: { data?: { enabled: boolean } } };
    const strictDataMode = strictData?.result?.data?.enabled ?? false;
    const voipData = voipRes.data as { result?: { data?: { enabled: boolean } } };
    const voipEnabled = voipData?.result?.data?.enabled ?? false;

    const latestCall: Promise<CallLogEntry | null> = apiRequest<unknown>(
      `/trpc/orders.latestCall?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    )
      .then((callRes) => {
        if (!callRes.ok) return null;
        const callData = callRes.data as { result?: { data?: CallLogEntry | null } };
        return callData?.result?.data ?? null;
      })
      .catch(() => null);

    const history: Promise<HistoryEntry[]> = apiRequest<unknown>(
      `/trpc/audit.recordHistory?input=${encodeURIComponent(JSON.stringify({ tableName: 'orders', recordId: orderId, page: 1, limit: 50 }))}`,
      { method: 'GET', cookie },
    )
      .then((historyRes) => {
        if (!historyRes.ok) return [];
        const historyData = historyRes.data as { result?: { data?: { rows: HistoryEntry[] } } };
        return historyData?.result?.data?.rows ?? [];
      })
      .catch(() => [] as HistoryEntry[]);

    return { order, latestCall, history, strictDataMode, voipEnabled };
  })();

  return defer({ orderDetail: orderDetailPromise });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const orderId = params['id'];

  if (!orderId) {
    return json({ error: 'Order ID required' }, { status: 400 });
  }

  if (intent === 'initiateCall') {
    const res = await apiRequest<unknown>('/trpc/orders.initiateCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to initiate call' }, { status: res.status });
    }

    return json({ success: true, callInitiated: true });
  }

  if (intent === 'revealPhone') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reveal phone' }, { status: res.status });
    }

    const data = res.data as { result?: { data?: { phone: string } } };
    return json({ success: true, phone: data?.result?.data?.phone ?? '', phoneRevealed: true });
  }

  if (intent === 'transition') {
    const newStatus = formData.get('newStatus')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() || undefined;
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString() || undefined;
    const logisticsProviderId = formData.get('logisticsProviderId')?.toString() || undefined;
    const riderId = formData.get('riderId')?.toString() || undefined;
    const deliveredQty = formData.get('deliveredQuantity')?.toString();
    const returnedQty = formData.get('returnedQuantity')?.toString();
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();

    const metadata: Record<string, unknown> = {};
    if (reason) metadata['reason'] = reason;
    if (logisticsLocationId) metadata['logisticsLocationId'] = logisticsLocationId;
    if (logisticsProviderId) metadata['logisticsProviderId'] = logisticsProviderId;
    if (riderId) metadata['riderId'] = riderId;
    if (deliveredQty) metadata['deliveredQuantity'] = parseInt(deliveredQty, 10);
    if (returnedQty) metadata['returnedQuantity'] = parseInt(returnedQty, 10);
    if (deliveryFeeAddOnStr) {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata['deliveryFeeAddOn'] = addOn;
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
      return json({ error: errorData?.error?.message ?? 'Transition failed' }, { status: res.status });
    }

    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function OrderDetailRoute() {
  const { orderDetail } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={orderDetail} skeleton="card">
      {(data) =>
        'notFound' in data && data.notFound ? (
          <div className="card text-center py-12">
            <p className="text-6xl font-bold text-surface-200 dark:text-surface-700 mb-4">404</p>
            <h2 className="text-xl font-bold text-surface-900 dark:text-white">Order not found</h2>
            <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">
              The order you're looking for doesn't exist or has been removed.
            </p>
            <a href="/admin/cs/orders" className="btn-primary mt-4 inline-block">
              Back to Orders
            </a>
          </div>
        ) : (
          <OrderDetailPage
            order={(data as OrderDetailStreamData).order}
            latestCall={(data as OrderDetailStreamData).latestCall}
            history={(data as OrderDetailStreamData).history}
            strictDataMode={(data as OrderDetailStreamData).strictDataMode}
            voipEnabled={(data as OrderDetailStreamData).voipEnabled}
          />
        )
      }
    </DeferredSection>
  );
}
