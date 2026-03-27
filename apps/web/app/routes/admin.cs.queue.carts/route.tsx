import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';

type ActivityItem = {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  productName: string | null;
  offerLabel: string | null;
  cartStatus: 'PENDING' | 'ABANDONED' | 'CONVERTED' | null;
  orderStatus: string | null;
  linkedOrderId: string | null;
  updatedAt: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cart.read');
  const cookie = getSessionCookie(request);

  const [activityRes, pendingRes, abandonedRes] = await Promise.all([
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
  ]);

  const activityItems: ActivityItem[] = activityRes.ok
    ? (activityRes.data as { result?: { data?: ActivityItem[] } })?.result?.data ?? []
    : [];
  const pendingCarts = pendingRes.ok
    ? (pendingRes.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
    : [];
  const abandonedCarts = abandonedRes.ok
    ? (abandonedRes.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
    : [];

  return json({ activityItems, pendingCarts, abandonedCarts });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'cart.delete');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'deleteAbandoned') {
    const cartId = formData.get('cartId');
    if (!cartId || typeof cartId !== 'string') {
      return json({ ok: false, error: 'Missing cartId' }, { status: 400 });
    }
    const res = await apiRequest<unknown>(
      '/trpc/cart.deleteAbandoned',
      {
        method: 'POST',
        cookie,
        body: JSON.stringify({ cartId }),
      },
    );
    if (!res.ok) {
      return json({ ok: false, error: 'Failed to delete cart' }, { status: 500 });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown intent' }, { status: 400 });
}

export default function AdminCsQueueCartsRoute() {
  return null;
}
