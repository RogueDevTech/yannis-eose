import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ messages: [] });

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return json({ messages: [] });

  const input = JSON.stringify({ orderId });
  const res = await apiRequest<{ result?: { data?: unknown[] } }>(
    `/trpc/messaging.outboxList?input=${encodeURIComponent(input)}`,
    { method: 'GET', cookie },
  );

  const messages = res.ok ? (res.data?.result?.data ?? []) : [];
  return json({ messages });
}
