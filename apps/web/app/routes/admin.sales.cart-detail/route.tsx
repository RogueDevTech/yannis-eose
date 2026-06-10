import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import type { PendingCart } from '~/features/cs/types';

/**
 * Resource route — single abandoned cart by id, for the "View cart" quick-detail
 * modal on the Sales orders cart-abandonment view.
 *
 * Gated on `orders.read` (the same permission the Sales orders page requires).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'orders.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const cartId = url.searchParams.get('cartId');
  if (!cartId) return json({ cart: null });

  const cartRes = await apiRequest<unknown>(
    `/trpc/cart.getById?input=${encodeURIComponent(JSON.stringify({ cartId }))}`,
    { method: 'GET', cookie },
  );
  const cart = cartRes.ok
    ? (cartRes.data as { result?: { data?: PendingCart | null } })?.result?.data ?? null
    : null;
  return json({ cart });
}
