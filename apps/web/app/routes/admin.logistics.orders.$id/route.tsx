import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

export const meta: MetaFunction = () => [
  { title: 'Logistics Order — Yannis EOSE' },
];

/**
 * The logistics-specific order detail page is being retired in favour of the unified
 * `/admin/orders/:id` view so Logistics, CS, Finance, and admins all see the same UI.
 * The unified page already permission-gates allocate / dispatch / share-to-3PL actions
 * so logistics roles get exactly the controls they need without a parallel feature page.
 *
 * The action handler stays here as a thin compatibility shim — older client code that
 * still POSTs to `/admin/logistics/orders/:id` keeps working.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['orders.read', 'logistics.read']);
  const orderId = params['id'];
  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }
  // Forward to the unified order detail page, preserving the search params (return-to, etc.).
  const url = new URL(request.url);
  const target = `/admin/orders/${orderId}${url.search}`;
  return redirect(target);
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
    const canTransitionDirect = user.role === 'HEAD_OF_LOGISTICS' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUPPORT';

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

// No default export needed — the loader always redirects to /admin/orders/:id, so
// this route never renders. Keeping the action handler above means any in-flight
// POSTs from older clients still resolve cleanly.
export default function LogisticsOrderDetailRoute() {
  return null;
}
