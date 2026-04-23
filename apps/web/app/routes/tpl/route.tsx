import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { Outlet, useLoaderData } from '@remix-run/react';
import { getCurrentUser, getSessionCookie, apiRequest } from '~/lib/api.server';
import { TplLayout } from '~/components/layout/tpl-layout';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  let user;
  try {
    user = await getCurrentUser(request);
  } catch {
    user = null;
  }

  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.pathname === '/tpl' ? '' : `?redirectTo=${url.pathname}`;
    return redirect(`/auth${redirectTo}`);
  }

  if (user.role !== 'TPL_MANAGER' && user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return redirect('/admin');
  }

  const cookie = getSessionCookie(request);
  const notificationsPromise = apiRequest<unknown>('/trpc/notifications.list?input=%7B%7D', { method: 'GET', cookie })
    .then((res) => {
      if (!res.ok) return { notifications: [] as Notification[], unreadCount: 0 };
      const data = (res.data as { result?: { data?: { notifications: Notification[]; unreadCount: number } } })?.result?.data;
      return data ?? { notifications: [] as Notification[], unreadCount: 0 };
    })
    .catch(() => ({ notifications: [] as Notification[], unreadCount: 0 }));

  return defer({ user, notifications: notificationsPromise });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  if (intent === 'markAllNotificationsRead') {
    const cookie = getSessionCookie(request);
    await apiRequest<unknown>('/trpc/notifications.markAllAsRead', { method: 'POST', cookie, body: {} });
    return json({ success: true });
  }
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplLayoutRoute() {
  const { user, notifications } = useLoaderData<typeof loader>();

  return (
    <TplLayout user={user} notificationsPromise={notifications}>
      <Outlet />
    </TplLayout>
  );
}
