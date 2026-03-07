import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cart.read');
  const cookie = getSessionCookie(request);

  const [pendingRes, abandonedRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/cart.listPending?input=${encodeURIComponent(JSON.stringify({ limit: 30 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/cart.listAbandoned?input=${encodeURIComponent(JSON.stringify({ limit: 50 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const pendingCarts = pendingRes.ok
    ? (pendingRes.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
    : [];
  const abandonedCarts = abandonedRes.ok
    ? (abandonedRes.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
    : [];

  return json({ pendingCarts, abandonedCarts });
}

export default function AdminCsQueueCartsRoute() {
  return null;
}
