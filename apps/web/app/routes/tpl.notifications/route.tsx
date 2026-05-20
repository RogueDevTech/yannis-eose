import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData, useSearchParams } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, parsePerPage } from '~/lib/api.server';
import { NotificationsPage } from '~/features/notifications/NotificationsPage';
import type { Notification } from '~/features/notifications/types';
import { TplNotificationsLoadingShell } from '~/features/tpl/TplDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Notifications — Yannis EOSE' },
];

interface ListResult {
  notifications: Notification[];
  unreadCount: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  // URL-driven page size — clamped to [20, 50, 100]; the `<Pagination>` per-page picker writes `perPage`.
  const { perPage: limit } = parsePerPage(url.searchParams);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  const emptyResult: ListResult = {
    notifications: [],
    unreadCount: 0,
    pagination: { page, limit, total: 0, totalPages: 0 },
  };

  const pageData = (async (): Promise<ListResult> => {
    const user = await getCurrentUser(request);
    if (!user) {
      return emptyResult;
    }

    const cookie = getSessionCookie(request);
    const input = encodeURIComponent(JSON.stringify({ page, limit, unreadOnly }));
    const res = await apiRequest<{ result?: { data?: ListResult } }>(
      `/trpc/notifications.list?input=${input}`,
      { method: 'GET', cookie },
    );

    return res.ok && res.data?.result?.data
      ? res.data.result.data
      : emptyResult;
  })();

  return defer({ pageData });
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
  const { pageData } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  return (
    <Suspense fallback={<TplNotificationsLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => (
          <NotificationsPage
            notifications={data.notifications}
            unreadCount={data.unreadCount}
            pagination={data.pagination}
            unreadOnlyFilter={unreadOnly}
            listBasePath="/tpl/notifications"
          />
        )}
      </Await>
    </Suspense>
  );
}
