import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const cookie = getSessionCookie(request);
  const form = await request.formData();

  const orderId = form.get('orderId')?.toString() ?? '';
  const channel = form.get('channel')?.toString() as 'SMS' | 'WHATSAPP' | undefined;
  const templateId = form.get('templateId')?.toString() || undefined;
  const body = form.get('body')?.toString() || undefined;

  if (!orderId || !channel) {
    return json({ error: 'orderId and channel are required' }, { status: 400 });
  }

  // Keep messaging behavior aligned with call: first engagement touches should move
  // UNPROCESSED/CS_ASSIGNED orders into CS_ENGAGED where policy allows.
  const orderRes = await apiRequest<{ result?: { data?: { status?: string } } }>(
    `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
    { method: 'GET', cookie },
  );
  if (orderRes.ok) {
    const currentStatus = orderRes.data?.result?.data?.status;
    if (currentStatus === 'UNPROCESSED' || currentStatus === 'CS_ASSIGNED') {
      const transitionRes = await apiRequest('/trpc/orders.transition', {
        method: 'POST',
        cookie,
        body: { orderId, newStatus: 'CS_ENGAGED' },
      });
      if (!transitionRes.ok) {
        const err = transitionRes.data as { error?: { message?: string } };
        return json({ error: err?.error?.message ?? 'Unable to engage order before messaging' }, { status: safeStatus(transitionRes.status) });
      }
    }
  }

  const res = await apiRequest('/trpc/messaging.sendMessage', {
    method: 'POST',
    cookie,
    body: { orderId, channel, templateId, body },
  });

  if (!res.ok) {
    const err = res.data as { error?: { message?: string } };
    return json({ error: err?.error?.message ?? 'Failed to send message' }, { status: safeStatus(res.status) });
  }

  return json({ success: true });
}

export function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
