import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS, getSessionCookie, requirePermission } from '~/lib/api.server';
import type { OrderInvoice } from '~/features/orders/types';
import { extractApiErrorMessage } from '~/lib/api-error';

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['orders.read', 'marketing.orders']);
  const cookie = getSessionCookie(request);
  const orderId = params['orderId'];
  if (!orderId) {
    return json({ ok: false, error: 'Order ID required', invoice: null });
  }

  const res = await apiRequest<unknown>(
    `/trpc/finance.getInvoiceByOrder?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  if (!res.ok) {
    const err = extractApiErrorMessage(res.data, 'Invoice could not be loaded');
    return json({ ok: false, error: err, invoice: null });
  }

  const data = (res.data as { result?: { data?: OrderInvoice | null } })?.result?.data ?? null;
  return secondaryCacheJson({ ok: true, invoice: data });
}

