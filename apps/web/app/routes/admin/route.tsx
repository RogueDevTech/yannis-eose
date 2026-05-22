import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { useEffect, useState } from 'react';
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

export type NotificationsData = {
  notifications: Notification[];
  unreadCount: number;
  /** Server-side total across all pages — used by the bell drawer to render
   *  "X total" alongside "Y unread", and to surface a "+N more on /notifications"
   *  hint when the drawer's first page is smaller than the user's full history. */
  total?: number;
};

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
    const destination = url.pathname + (url.search || '');
    const redirectTo = destination ? `?redirectTo=${encodeURIComponent(destination)}` : '';
    return redirect(`/auth${redirectTo}`);
  }

  if (user.role === 'TPL_MANAGER') {
    return redirect('/tpl');
  }

  const cookie = getSessionCookie(request);
  // Default page size = 20. The drawer shows the latest 20; older history is reachable
  // via the "View all notifications" link (full pagination on `/admin/notifications`).
  // We still pull `pagination.total` so the drawer header can show "(N total)" and
  // surface a "+M older in history" hint when more exist beyond the first page.
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

  // Fetch user's branches for the branch switcher (non-blocking)
  const branchesPromise = apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie })
    .then((res) => {
      if (!res.ok) return [] as Array<{ id: string; name: string; code: string }>;
      const data = (res.data as { result?: { data?: Array<{ id: string; name: string; code: string }> } })?.result?.data;
      return data ?? [];
    })
    .catch(() => [] as Array<{ id: string; name: string; code: string }>);

  // Stream branches like notifications — avoids blocking the document on branches.list
  return defer({ user, notifications: notificationsPromise, branches: branchesPromise });
}

/**
 * Skip re-running this shell loader on every child-route navigation. Without this, going
 * from `/admin/orders` to `/admin/orders/123` re-fetches the current user, the branch
 * list, and the first 20 notifications — three round-trips that already lived in memory.
 *
 * What still triggers a revalidation:
 *   • `<PageRefreshButton>` / any `useRevalidator().revalidate()` call (bypasses this hook
 *     entirely — Remix re-runs every loader regardless of `shouldRevalidate`).
 *   • Form submissions to this route's action (mark-all-read, exit-mirror, branch switch
 *     elsewhere posts to `/admin/branches/switch` which lives at this layout). When
 *     `formAction` is set we honour `defaultShouldRevalidate` so Remix's standard rules
 *     apply (it'll revalidate after a successful POST).
 *   • Real-time notification arrivals: those come via Socket.io (`notification:new`
 *     event) and update local state directly — no loader re-run needed.
 *
 * What's intentionally skipped:
 *   • Pure child-route navigation (the most common case in this app). The shell data
 *     hasn't changed, so we return false and Remix reuses the cached loader payload.
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

  // Exit Mirror Mode — restores the original admin session and bounces home.
  // The success path always redirects so the freshly-restored cookie is used on the next render.
  if (intent === 'exitMirror') {
    const res = await apiRequest<unknown>('/auth/mirror/stop', {
      method: 'POST', cookie, body: {},
    });
    if (!res.ok) {
      const errorData = res.data as { message?: string };
      return json({ success: false, error: errorData?.message ?? 'Failed to exit mirror' });
    }
    const headers = new Headers();
    for (const c of res.setCookies) {
      headers.append('Set-Cookie', c);
    }
    throw redirect('/admin', { headers });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

/**
 * Admin layout route — wraps all /admin/* routes with the dashboard layout.
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
export default function AdminLayout() {
  const { user, notifications, branches } = useLoaderData<typeof loader>();
  const [resolvedBranches, setResolvedBranches] = useState<
    Array<{ id: string; name: string; code: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    // An empty result is almost always a transient `branches.list` failure
    // (a request aborted by rapid branch switching) — every user has at least
    // one branch. Keep the last-known-good non-empty list rather than blinking
    // the switcher out; the next loader run refills it.
    const apply = (value: Array<{ id: string; name: string; code: string }>) => {
      if (cancelled) return;
      setResolvedBranches((prev) =>
        value.length === 0 && prev && prev.length > 0 ? prev : value,
      );
    };
    Promise.resolve(branches)
      .then((value) => apply(value))
      .catch(() => apply([]));
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
      errorData={isResponse ? normalizeRouteErrorData(error.data) : undefined}
    />
  );
}
