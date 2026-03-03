import { json, redirect } from '@remix-run/node';
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

/**
 * Loader — check session and redirect to /auth if not authenticated.
 * Also fetches notifications for the header bell.
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
    const redirectTo = url.pathname === '/admin' ? '' : `?redirectTo=${url.pathname}`;
    return redirect(`/auth${redirectTo}`);
  }

  // Fetch notifications in parallel
  const cookie = getSessionCookie(request);
  const [notifRes] = await Promise.all([
    apiRequest<unknown>('/trpc/notifications.list?input=%7B%7D', { method: 'GET', cookie }),
  ]);

  const notifData = notifRes.ok
    ? (notifRes.data as { result?: { data?: { notifications: Notification[]; unreadCount: number } } })?.result?.data
    : null;

  return json({
    user,
    notifications: notifData?.notifications ?? [],
    unreadCount: notifData?.unreadCount ?? 0,
  });
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

/**
 * Admin layout route — wraps all /admin/* routes with the dashboard layout.
 * Child routes render inside the <Outlet /> within DashboardLayout.
 */
export default function AdminLayout() {
  const { user, notifications, unreadCount } = useLoaderData<typeof loader>();

  return (
    <DashboardLayout
      user={user}
      notifications={notifications}
      unreadCount={unreadCount}
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
