import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { RiderDashboardPage } from '~/features/rider/RiderDashboardPage';
import type { Order } from '~/features/rider/types';

export const meta: MetaFunction = () => [
  { title: 'Yannis EOSE — Rider Dashboard' },
  { name: 'description', content: '3PL Rider Mobile Dashboard' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'rider.dashboard');
  const cookie = getSessionCookie(request);

  // Fetch both DISPATCHED (pickup) and IN_TRANSIT (delivery) orders for the rider
  const [dispatchedRes, inTransitRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ riderId: user.id, status: 'DISPATCHED', limit: 20 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ riderId: user.id, status: 'IN_TRANSIT', limit: 20 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const parseOrders = (res: { ok: boolean; data: unknown }) => {
    if (!res.ok) return { orders: [], total: 0 };
    const d = (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number } } } })?.result?.data;
    return { orders: d?.orders ?? [], total: d?.pagination?.total ?? 0 };
  };

  const dispatched = parseOrders(dispatchedRes);
  const inTransit = parseOrders(inTransitRes);

  return {
    orders: inTransit.orders,
    dispatchedOrders: dispatched.orders,
    total: inTransit.total,
    dispatchedTotal: dispatched.total,
    userId: user.id,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'rider.dashboard');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();

  const orderId = formData.get('orderId')?.toString() ?? '';
  const newStatus = formData.get('newStatus')?.toString() ?? '';
  const otp = formData.get('otp')?.toString();
  const gpsLat = formData.get('gpsLat')?.toString();
  const gpsLng = formData.get('gpsLng')?.toString();
  const reason = formData.get('reason')?.toString();
  const deliveredQuantity = formData.get('deliveredQuantity')?.toString();
  const returnedQuantity = formData.get('returnedQuantity')?.toString();
  const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();

  const metadata: Record<string, unknown> = {};
  if (otp) metadata.otp = otp;
  if (gpsLat) metadata.gpsLat = parseFloat(gpsLat);
  if (gpsLng) metadata.gpsLng = parseFloat(gpsLng);
  if (reason) metadata.reason = reason;
  if (deliveredQuantity) metadata.deliveredQuantity = parseInt(deliveredQuantity, 10);
  if (returnedQuantity) metadata.returnedQuantity = parseInt(returnedQuantity, 10);
  if (deliveryFeeAddOnStr) {
    const addOn = parseFloat(deliveryFeeAddOnStr);
    if (!Number.isNaN(addOn) && addOn >= 0) metadata.deliveryFeeAddOn = addOn;
  }

  // DELIVERED and PARTIALLY_DELIVERED require HOL approval: submit request instead of direct transition
  if (newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED') {
    const res = await apiRequest<unknown>('/trpc/logistics.submitDeliveryConfirmation', {
      method: 'POST',
      cookie,
      body: { orderId, newStatus, metadata },
    });
    if (!res.ok) {
      const errData = res.data as { error?: { message?: string } };
      return json(
        { error: errData?.error?.message ?? 'Submit failed', success: false },
        { status: 400 },
      );
    }
    return json({ success: true, error: null, message: 'Delivery confirmation submitted; pending Head of Logistics approval.' });
  }

  const res = await apiRequest<unknown>('/trpc/orders.transition', {
    method: 'POST',
    cookie,
    body: { orderId, newStatus, metadata },
  });

  if (!res.ok) {
    const errData = res.data as { error?: { message?: string } };
    return json(
      { error: errData?.error?.message ?? 'Transition failed', success: false },
      { status: 400 },
    );
  }

  return json({ success: true, error: null });
}

export default function RiderDashboardRoute() {
  const data = useLoaderData<typeof loader>();
  return <RiderDashboardPage {...data} />;
}
