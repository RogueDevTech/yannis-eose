import { useMemo } from 'react';
import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { defer, json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermission, safeStatus } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OrderDetailPage } from '~/features/orders/OrderDetailPage';
import type { CallLogEntry, OrderDetail, OrderDetailStreamData, OrderInvoice, TimelineEvent } from '~/features/orders/types';

export const meta: MetaFunction = () => [
  { title: 'Order Detail — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, ['orders.read', 'marketing.orders']);
  const cookie = getSessionCookie(request);
  const orderId = params['id'];

  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }

  const orderDetailPromise = (async (): Promise<OrderDetailStreamData | { notFound: true }> => {
    const [orderRes, voipRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/voip.isEnabled', { method: 'GET', cookie }),
    ]);

    if (!orderRes.ok) return { notFound: true };

    const trpcData = orderRes.data as { result?: { data?: OrderDetail } };
    const order = trpcData?.result?.data;

    if (!order) return { notFound: true };

    // `voip.isEnabled` returns the on/off flag plus the active provider's display name. We
    // pass the display name through to the OrderDetailPage so the call panel can read
    // "Africa's Talking will ring your phone" instead of hardcoding the brand name.
    const voipData = voipRes.data as {
      result?: { data?: { enabled: boolean; providerDisplayName?: string } };
    };
    const voipPayload = voipData?.result?.data;
    const voipEnabled = voipPayload?.enabled ?? false;
    const voipProviderDisplayName = voipPayload?.providerDisplayName ?? "Africa's Talking";

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

    const timeline: Promise<TimelineEvent[]> = apiRequest<unknown>(
      `/trpc/orders.getTimeline?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    )
      .then((tlRes) => {
        if (!tlRes.ok) return [];
        const tlData = tlRes.data as { result?: { data?: TimelineEvent[] } };
        return tlData?.result?.data ?? [];
      })
      .catch(() => [] as TimelineEvent[]);

    return {
      order,
      latestCall,
      timeline,
      voipEnabled,
      voipProviderDisplayName,
    };
  })();

  let csAgentsForAssign: Array<{ id: string; name: string }> | undefined;
  // SA + ADMIN bypass permission checks at middleware (permissions: []); include them explicitly.
  if (isAdminLevel(user) || user.permissions?.includes('orders.reassign')) {
    const agentsRes = await apiRequest<unknown>('/trpc/orders.listCSAgents', { method: 'GET', cookie });
    if (agentsRes.ok) {
      const agentsData = agentsRes.data as { result?: { data?: Array<{ agentId: string; agentName: string }> } };
      const list = agentsData?.result?.data ?? [];
      csAgentsForAssign = list.map((a) => ({ id: a.agentId, name: a.agentName }));
    }
  }

  // Logistics locations — used by the "Allocate to 3PL" action available to the assigned
  // CS agent, Logistics, and admins when the order is CONFIRMED.
  let logisticsLocations: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null }> = [];
  const locationsRes = await apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100 }))}`,
    { method: 'GET', cookie },
  );
  if (locationsRes.ok) {
    const locationsData = locationsRes.data as {
      result?: { data?: { locations?: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null }> } };
    };
    logisticsLocations = locationsData?.result?.data?.locations ?? [];
  }

  // Dispatch templates for the "Share to 3PL" WhatsApp flow.
  let logisticsDispatchTemplates: Array<{ id: string; name: string; body: string }> = [];
  const templatesRes = await apiRequest<unknown>(
    `/trpc/messaging.templates.list?input=${encodeURIComponent(JSON.stringify({ channel: 'WHATSAPP_GROUP' }))}`,
    { method: 'GET', cookie },
  );
  if (templatesRes.ok) {
    const templatesData = templatesRes.data as { result?: { data?: Array<{ id: string; name: string; body: string }> } };
    logisticsDispatchTemplates = templatesData?.result?.data ?? [];
  }

  // Stream the auto-generated invoice (if any) — orders confirmed before this feature
  // landed have null. Used by the order detail page to render an Invoice card.
  const invoicePromise: Promise<OrderInvoice | null> = apiRequest<unknown>(
    `/trpc/finance.getInvoiceByOrder?input=${encodeURIComponent(JSON.stringify({ orderId: params['id'] }))}`,
    { method: 'GET', cookie },
  ).then((res) => {
    if (!res.ok) return null;
    const data = (res.data as { result?: { data?: OrderInvoice | null } })?.result?.data ?? null;
    return data;
  }).catch(() => null);

  return defer({
    orderDetail: orderDetailPromise,
    canEditOrder: user.role !== 'MEDIA_BUYER',
    userRole: user.role,
    userId: user.id,
    permissions: user.permissions ?? [],
    csAgentsForAssign: csAgentsForAssign,
    logisticsLocations,
    logisticsDispatchTemplates,
    invoice: invoicePromise,
  });
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

  if (intent === 'assignToCS') {
    await requirePermission(request, 'orders.reassign');
    const toCsAgentId = formData.get('toCsAgentId')?.toString();
    if (!toCsAgentId) {
      return json({ error: 'Agent required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.assignToCS', {
      method: 'POST',
      cookie,
      body: { orderId, csAgentId: toCsAgentId },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Assign failed';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }


  if (intent === 'initiateCall') {
    const res = await apiRequest<unknown>('/trpc/orders.initiateCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to initiate call' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { callLog: unknown; providerError?: string } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      callInitiated: true,
      callLog: payload?.callLog ?? null,
      providerError: payload?.providerError,
    });
  }

  if (intent === 'revealPhone') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reveal phone' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'revealPhoneForWhatsApp') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to prepare WhatsApp message' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'revealPhoneForSms') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to prepare SMS recipient' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'preparePhoneForWhatsApp') {
    const orderRes = await apiRequest<{ result?: { data?: { status?: string } } }>(
      `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    );
    const currentStatus = orderRes.data?.result?.data?.status;
    if (currentStatus !== 'CS_ENGAGED') {
      return json({ ready: false });
    }

    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ ready: false, error: errorData?.error?.message ?? 'Failed to prepare WhatsApp recipient' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      ready: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
    });
  }

  if (intent === 'preparePhoneForSms') {
    const orderRes = await apiRequest<{ result?: { data?: { status?: string } } }>(
      `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    );
    const currentStatus = orderRes.data?.result?.data?.status;
    if (currentStatus !== 'CS_ENGAGED') {
      return json({ ready: false });
    }

    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ ready: false, error: errorData?.error?.message ?? 'Failed to prepare SMS recipient' }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      ready: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
    });
  }

  if (intent === 'adjustOrderItems') {
    const allowedRoles = ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'Only CS or Head of CS can adjust order items' }, { status: 403 });
    }
    const itemsRaw = formData.get('items')?.toString();
    const totalAmountStr = formData.get('totalAmount')?.toString();
    if (!itemsRaw) {
      return json({ error: 'Items are required' }, { status: 400 });
    }
    let parsedItems: Array<{ productId: string; quantity: number; unitPrice: number }>;
    try {
      const arr = JSON.parse(itemsRaw) as unknown;
      if (!Array.isArray(arr) || arr.length === 0) {
        return json({ error: 'At least one item is required' }, { status: 400 });
      }
      parsedItems = arr.map((row: unknown) => {
        if (row == null || typeof row !== 'object') throw new Error('Invalid item');
        const o = row as Record<string, unknown>;
        const productId = typeof o.productId === 'string' ? o.productId : '';
        const quantity = typeof o.quantity === 'number' ? o.quantity : Number(o.quantity);
        const unitPrice = typeof o.unitPrice === 'number' ? o.unitPrice : Number(o.unitPrice);
        if (!productId || Number.isNaN(quantity) || quantity < 1 || Number.isNaN(unitPrice) || unitPrice < 0) {
          throw new Error('Invalid item fields');
        }
        return { productId, quantity, unitPrice };
      });
    } catch {
      return json({ error: 'Invalid items format' }, { status: 400 });
    }
    const totalAmount = totalAmountStr != null && totalAmountStr !== ''
      ? parseFloat(totalAmountStr)
      : parsedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      return json({ error: 'Invalid total amount' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.update', {
      method: 'POST',
      cookie,
      body: { orderId, items: parsedItems, totalAmount },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to update order items';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'scheduleCallback') {
    const delayMinutesStr = formData.get('delayMinutes')?.toString();
    const delayMinutes = delayMinutesStr ? parseInt(delayMinutesStr, 10) : 120;
    const notes = formData.get('notes')?.toString() || undefined;
    if (Number.isNaN(delayMinutes) || delayMinutes < 5 || delayMinutes > 10080) {
      return json({ error: 'Invalid delay (5 min to 7 days)' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.scheduleCallback', {
      method: 'POST',
      cookie,
      body: { orderId, delayMinutes, notes },
    });
    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Schedule failed';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true, scheduled: true });
  }

  if (intent === 'transition') {
    const newStatus = (formData.get('newStatus')?.toString() ?? '').trim();
    if (!newStatus) {
      return json({ error: 'Status is required' }, { status: 400 });
    }
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED', 'CANCELLED'];
    if (csOnlyStatuses.includes(newStatus)) {
      const allowedRoles = ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'];
      if (!allowedRoles.includes(user.role)) {
        return json({ error: 'Only CS or Head of CS can perform this action' }, { status: 403 });
      }
    }
    const reason = formData.get('reason')?.toString() || undefined;
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString() || undefined;
    const logisticsProviderId = formData.get('logisticsProviderId')?.toString() || undefined;
    const riderId = formData.get('riderId')?.toString() || undefined;
    const deliveredQtyStr = formData.get('deliveredQuantity')?.toString();
    const returnedQtyStr = formData.get('returnedQuantity')?.toString();
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();

    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString() || undefined;
    const deliveryNote = formData.get('deliveryNote')?.toString() || undefined;
    const deliveryProofUrl = formData.get('deliveryProofUrl')?.toString() || undefined;

    const metadata: Record<string, unknown> = {};
    if (reason) metadata['reason'] = reason;
    if (logisticsLocationId) metadata['logisticsLocationId'] = logisticsLocationId;
    if (logisticsProviderId) metadata['logisticsProviderId'] = logisticsProviderId;
    if (riderId) metadata['riderId'] = riderId;
    if (preferredDeliveryDate) metadata['preferredDeliveryDate'] = preferredDeliveryDate;
    if (deliveryNote) metadata['deliveryNote'] = deliveryNote;
    if (deliveryProofUrl) metadata['deliveryProofUrl'] = deliveryProofUrl;
    const deliveredQty = deliveredQtyStr != null ? parseInt(deliveredQtyStr, 10) : NaN;
    if (!Number.isNaN(deliveredQty) && Number.isInteger(deliveredQty) && deliveredQty >= 0) {
      metadata['deliveredQuantity'] = deliveredQty;
    }
    const returnedQty = returnedQtyStr != null ? parseInt(returnedQtyStr, 10) : NaN;
    if (!Number.isNaN(returnedQty) && Number.isInteger(returnedQty) && returnedQty >= 0) {
      metadata['returnedQuantity'] = returnedQty;
    }
    if (deliveryFeeAddOnStr) {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata['deliveryFeeAddOn'] = addOn;
    }
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) metadata['deliveryDiscountAmount'] = discount;
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

const ORDER_DETAIL_EVENTS = ['order:status_changed', 'order:assigned', 'order:transfer_accepted', 'order:transfer_rejected'] as const;

export default function OrderDetailRoute() {
  const { orderDetail, canEditOrder, userRole, userId, permissions, csAgentsForAssign, logisticsLocations, logisticsDispatchTemplates, invoice } = useLoaderData<typeof loader>();
  const orderEvents = useMemo(() => [...ORDER_DETAIL_EVENTS], []);
  usePageRefreshOnEvent(orderEvents);
  return (
    <DeferredSection resolve={orderDetail} skeleton="card">
      {(data) =>
        'notFound' in data && data.notFound ? (
          <div className="card text-center py-12">
            <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
            <h2 className="text-xl font-bold text-app-fg">Order not found</h2>
            <p className="mt-2 text-sm text-app-fg-muted">
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
            timeline={(data as OrderDetailStreamData).timeline}
            voipEnabled={(data as OrderDetailStreamData).voipEnabled}
            voipProviderDisplayName={(data as OrderDetailStreamData).voipProviderDisplayName}
            canEditOrder={canEditOrder}
            userRole={userRole}
            userId={userId}
            permissions={permissions}
            csAgentsForAssign={csAgentsForAssign}
            logisticsLocations={logisticsLocations}
            logisticsDispatchTemplates={logisticsDispatchTemplates}
            invoice={invoice}
          />
        )
      }
    </DeferredSection>
  );
}
