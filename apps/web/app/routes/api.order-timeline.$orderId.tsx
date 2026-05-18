import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS, getSessionCookie, requirePermission } from '~/lib/api.server';
import type { TimelineEvent } from '~/features/orders/types';
import { extractApiErrorMessage } from '~/lib/api-error';

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['orders.read', 'marketing.orders']);
  const cookie = getSessionCookie(request);
  const orderId = params['orderId'];
  if (!orderId) {
    return json({ ok: false, error: 'Order ID required', timeline: [] as TimelineEvent[] });
  }

  const res = await apiRequest<unknown>(
    `/trpc/orders.getTimeline?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  if (!res.ok) {
    const err = extractApiErrorMessage(res.data, 'Order Activity could not be loaded');
    return json({ ok: false, error: err, timeline: [] as TimelineEvent[] });
  }

  const data = (res.data as { result?: { data?: TimelineEvent[] } })?.result?.data ?? [];
  return secondaryCacheJson({ ok: true, timeline: data });
}

