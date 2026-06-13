import { useEffect, useState } from 'react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import type { ShouldRevalidateFunction } from '@remix-run/react';
import { DashboardLayout } from '~/components/layout/dashboard-layout';
import { getCurrentUser, apiRequest, getSessionCookie } from '~/lib/api.server';
import { AdminErrorBoundary } from '~/features/admin-layout/AdminErrorBoundary';
import { normalizeRouteErrorData } from '~/lib/network-error';

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
  } catch (e) {
    if (e instanceof Response) throw e;
    user = null;
  }

  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.pathname === '/admin' ? '' : `?redirectTo=${url.pathname}`;
    return redirect(`/auth${redirectTo}`);
  }

  const cookie = getSessionCookie(request);
  // Default page size = 20. See `routes/admin/route.tsx` for the rationale.
  const notificationsInput = encodeURIComponent(JSON.stringify({ limit: 20 }));
  const notificationsPromise = apiRequest<unknown>(`/trpc/notifications.list?input=${notificationsInput}`, { method: 'GET', cookie })
    .then((res) => {
      if (!res.ok) return { notifications: [] as Notification[], unreadCount: 0, total: 0 };
      const data = (res.data as {
        result?: {
          data?: {
            notifications: Notification[];
            unreadCount: number;
            pagination?: { total?: number };
          };
        };
      })?.result?.data;
      return {
        notifications: data?.notifications ?? [],
        unreadCount: data?.unreadCount ?? 0,
        total: data?.pagination?.total ?? data?.notifications?.length ?? 0,
      };
    })
    .catch(() => ({ notifications: [] as Notification[], unreadCount: 0, total: 0 }));

  // Fetch user's branches for the branch switcher (non-blocking, streamed alongside notifications).
  // Must mirror the /admin layout — without this, /hr/* pages silently hide the switcher.
  const branchesPromise = apiRequest<unknown>('/trpc/branches.listAll', { method: 'GET', cookie })
    .then((res) => {
      if (!res.ok) return [] as Array<{ id: string; name: string; code: string }>;
      const data = (res.data as { result?: { data?: Array<{ id: string; name: string; code: string }> } })?.result?.data;
      return data ?? [];
    })
    .catch(() => [] as Array<{ id: string; name: string; code: string }>);

  return defer({ user, notifications: notificationsPromise, branches: branchesPromise });
}

/**
 * Skip re-running this shell loader on every child-route navigation. See the matching
 * comment in `routes/admin/route.tsx::shouldRevalidate` for the full rationale —
 * tl;dr the shell data (current user, initial notifications batch) is stable between
 * sub-routes, and `useRevalidator().revalidate()` / form submissions still trigger a
 * refresh.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  defaultShouldRevalidate,
  formAction,
  formMethod,
}) => {
  if (formAction && formMethod && formMethod !== 'GET') {
    return defaultShouldRevalidate;
  }
  return false;
};

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
 * HR layout route — wraps all /hr/* routes with the dashboard layout.
 * Child routes render inside the <Outlet /> within DashboardLayout.
 *
 * The branches promise is bridged into state instead of resolved via a
 * Suspense boundary. The previous Suspense+Await pattern rendered
 * `<DashboardLayout>` in two distinct React positions (fallback vs Await
 * children); when branches resolved, React unmounted the fallback subtree
 * and mounted the children subtree, which also remounted the `<Outlet />`
 * and every child route's local state — child pages would re-fire their
 * own deferred-promise skeletons, looking like a double flicker.
 *
 * Single mount + state bridge keeps the Outlet alive across resolution.
 */
export default function HrLayout() {
  const { user, notifications, branches } = useLoaderData<typeof loader>();
  const [resolvedBranches, setResolvedBranches] = useState<
    Array<{ id: string; name: string; code: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(branches)
      .then((value) => {
        if (!cancelled) setResolvedBranches(value);
      })
      .catch(() => {
        if (!cancelled) setResolvedBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branches]);

  return (
    <DashboardLayout
      user={user}
      branches={resolvedBranches ?? []}
      branchesHydrationReady={resolvedBranches !== null}
      notificationsPromise={notifications}
      notificationsActionUrl="/hr"
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
      errorData={isResponse ? normalizeRouteErrorData(error.data) : undefined}
    />
  );
}
