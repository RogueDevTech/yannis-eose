import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { DashboardLayout } from '~/components/layout/dashboard-layout';
import { getCurrentUser, apiRequest, getSessionCookie } from '~/lib/api.server';
import { AdminErrorBoundary } from '~/features/admin-layout/AdminErrorBoundary';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export type NotificationsData = { notifications: Notification[]; unreadCount: number };

/**
 * Loader — check session and redirect to /auth if not authenticated.
 * Notifications are deferred so navigation is not blocked.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  let user;
  try {
    user = await getCurrentUser(request);
  } catch {
    user = null;
  }

  if (!user) {
    const url = new URL(request.url);
    const destination = url.pathname + (url.search || '');
    const redirectTo = destination ? `?redirectTo=${encodeURIComponent(destination)}` : '';
    return redirect(`/auth${redirectTo}`);
  }

  if (user.role === 'TPL_MANAGER') {
    return redirect('/tpl');
  }

  const cookie = getSessionCookie(request);
  const notificationsPromise = apiRequest<unknown>('/trpc/notifications.list?input=%7B%7D', { method: 'GET', cookie })
    .then((res) => {
      if (!res.ok) return { notifications: [] as Notification[], unreadCount: 0 };
      const data = (res.data as { result?: { data?: NotificationsData } })?.result?.data;
      return data ?? { notifications: [] as Notification[], unreadCount: 0 };
    })
    .catch(() => ({ notifications: [] as Notification[], unreadCount: 0 }));

  return defer({ user, notifications: notificationsPromise });
}

/**
 * Action — handle mark-all-read from the notification panel.
 */
export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'markAllNotificationsRead') {
    await apiRequest<unknown>('/trpc/notifications.markAllAsRead', {
      method: 'POST',
      cookie,
      body: {},
    });
    return json({ success: true });
  }

  if (intent === 'markNotificationRead') {
    const notificationId = formData.get('notificationId')?.toString();
    if (notificationId) {
      const res = await apiRequest<unknown>('/trpc/notifications.markAsRead', {
        method: 'POST',
        cookie,
        body: { notificationIds: [notificationId] },
      });
      if (!res.ok) {
        const errMsg = (res.data && typeof res.data === 'object' && (res.data as { error?: { message?: string } }).error?.message) ?? 'Mark read failed';
        return json({ success: false, error: errMsg });
      }
      return json({ success: true });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

/**
 * Admin layout route — wraps all /admin/* routes with the dashboard layout.
 * Child routes render inside the <Outlet /> within DashboardLayout.
 */
export default function AdminLayout() {
  const { user, notifications } = useLoaderData<typeof loader>();

  return (
    <DashboardLayout
      user={user}
      notificationsPromise={notifications}
      notificationsActionUrl="/admin"
    />
  );
}

/**
 * ErrorBoundary — catches errors in any child admin route.
 * Renders within the admin shell so the sidebar/header stay intact.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;

  return (
    <AdminErrorBoundary
      error={error}
      isResponse={isResponse}
      status={status}
      errorData={isResponse ? error.data : undefined}
    />
  );
}
