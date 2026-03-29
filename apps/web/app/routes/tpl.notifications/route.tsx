import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';
import { NotificationsPage } from '~/features/notifications/NotificationsPage';
import type { Notification } from '~/features/notifications/types';

export const meta: MetaFunction = () => [
  { title: 'Notifications — Yannis EOSE' },
];

interface ListResult {
  notifications: Notification[];
  unreadCount: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ notifications: [], unreadCount: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  const cookie = getSessionCookie(request);
  const input = encodeURIComponent(JSON.stringify({ page, limit, unreadOnly }));
  const res = await apiRequest<{ result?: { data?: ListResult } }>(
    `/trpc/notifications.list?input=${input}`,
    { method: 'GET', cookie },
  );

  const data: ListResult = res.ok && res.data?.result?.data
    ? res.data.result.data
    : { notifications: [], unreadCount: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

  return json(data);
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'markAllRead') {
    await apiRequest<unknown>('/trpc/notifications.markAllAsRead', { method: 'POST', cookie, body: {} });
    return json({ success: true });
  }

  if (intent === 'markRead') {
    const notificationId = formData.get('notificationId')?.toString();
    if (notificationId) {
      await apiRequest<unknown>('/trpc/notifications.markAsRead', {
        method: 'POST',
        cookie,
        body: { notificationIds: [notificationId] },
      });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplNotificationsRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  return (
    <NotificationsPage
      notifications={data.notifications}
      unreadCount={data.unreadCount}
      pagination={data.pagination}
      unreadOnlyFilter={unreadOnly}
      listBasePath="/tpl/notifications"
    />
  );
}
