import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { ABANDONED_CARTS_PAGE_SIZE, type AbandonedCartPagination } from '~/features/cs/types';

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
  const url = new URL(request.url);
  const abandonedPageRaw = parseInt(url.searchParams.get('abandonedPage') ?? '1', 10);
  const abandonedPage =
    Number.isFinite(abandonedPageRaw) && abandonedPageRaw >= 1 ? abandonedPageRaw : 1;

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
      `/trpc/cart.listAbandoned?input=${encodeURIComponent(
        JSON.stringify({ page: abandonedPage, limit: ABANDONED_CARTS_PAGE_SIZE }),
      )}`,
      { method: 'GET', cookie },
    ),
  ]);

  const activityItems: ActivityItem[] = activityRes.ok
    ? (activityRes.data as { result?: { data?: ActivityItem[] } })?.result?.data ?? []
    : [];
  const pendingCarts = pendingRes.ok
    ? (pendingRes.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
    : [];
  const abandonedPayload = abandonedRes.ok
    ? (abandonedRes.data as {
        result?: {
          data?: {
            items: Array<{
              id: string;
              customerName: string;
              customerPhoneDisplay: string;
              customerPhone?: string | null;
              productId?: string | null;
              productName: string | null;
              campaignName: string | null;
              offerLabel: string | null;
              updatedAt: string;
              customerEmail?: string | null;
              customerAddress?: string | null;
              deliveryAddress?: string | null;
              deliveryState?: string | null;
              deliveryNotes?: string | null;
              customerGender?: string | null;
              preferredDeliveryDate?: string | null;
              paymentMethod?: string | null;
              quantity?: number | null;
              customFieldValues?: Record<string, unknown> | null;
            }>;
            total: number;
            page: number;
            limit: number;
          };
        };
      })?.result?.data
    : undefined;
  const abandonedCarts = abandonedPayload?.items ?? [];
  const abandonedPagination: AbandonedCartPagination = abandonedPayload
    ? { total: abandonedPayload.total, page: abandonedPayload.page, limit: abandonedPayload.limit }
    : { total: 0, page: 1, limit: ABANDONED_CARTS_PAGE_SIZE };

  return json({ activityItems, pendingCarts, abandonedCarts, abandonedPagination });
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
        // `apiRequest` calls `JSON.stringify(body)` internally — pass the object, not a string.
        body: { cartId },
      },
    );
    if (!res.ok) {
      return json({ ok: false, error: 'Failed to delete cart' }, { status: 500 });
    }
    return json({ ok: true });
  }

  if (intent === 'deleteAbandonedMany') {
    const raw = formData.get('cartIds');
    if (!raw || typeof raw !== 'string') {
      return json({ ok: false, error: 'Missing cartIds' }, { status: 400 });
    }
    const cartIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (cartIds.length === 0) {
      return json({ ok: false, error: 'No carts selected' }, { status: 400 });
    }
    const results = await Promise.all(
      cartIds.map((cartId) =>
        apiRequest<unknown>('/trpc/cart.deleteAbandoned', {
          method: 'POST',
          cookie,
          body: { cartId },
        }),
      ),
    );
    const failed = results.filter((r) => !r.ok).length;
    return json({
      ok: failed === 0,
      deleted: cartIds.length - failed,
      failed,
      total: cartIds.length,
      error: failed > 0 ? `${failed} of ${cartIds.length} carts could not be deleted` : undefined,
    });
  }

  if (intent === 'recoverFromCart') {
    const cartId = formData.get('cartId');
    if (!cartId || typeof cartId !== 'string') {
      return json({ success: false, error: 'Missing cartId' }, { status: 400 });
    }
    const res = await apiRequest<{ result?: { data?: { id: string } } }>(
      '/trpc/orders.recoverFromCart',
      { method: 'POST', cookie, body: { cartId } },
    );
    if (!res.ok) {
      return json(
        { success: false, error: extractApiErrorMessage(res.data, 'Failed to recover cart') },
        { status: 500 },
      );
    }
    const orderId = res.data?.result?.data?.id;
    return json({ success: true, orderId });
  }

  if (intent === 'revealAbandonedPhone') {
    const cartId = formData.get('cartId');
    if (!cartId || typeof cartId !== 'string') {
      return json({ ok: false, error: 'Missing cartId' }, { status: 400 });
    }
    const res = await apiRequest<unknown>(
      '/trpc/cart.revealPhoneForAbandoned',
      { method: 'POST', cookie, body: { cartId } },
    );
    if (!res.ok) {
      return json({ ok: false, error: 'Failed to reveal phone' }, { status: 500 });
    }
    const data = (res.data as { result?: { data?: { phone?: string; isDialable?: boolean } } })?.result?.data;
    return json({
      ok: true,
      phone: data?.phone ?? '',
      isDialable: !!data?.isDialable,
    });
  }

  return json({ ok: false, error: 'Unknown intent' }, { status: 400 });
}

export default function AdminCsQueueCartsRoute() {
  return null;
}
