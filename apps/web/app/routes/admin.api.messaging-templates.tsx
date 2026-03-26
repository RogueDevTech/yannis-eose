import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ templates: [] });

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel');

  const input = JSON.stringify(channel ? { channel } : {});
  const res = await apiRequest<{ result?: { data?: unknown[] } }>(
    `/trpc/messaging.templates.list?input=${encodeURIComponent(input)}`,
    { method: 'GET', cookie },
  );

  const templates = res.ok ? (res.data?.result?.data ?? []) : [];
  return json({ templates });
}
