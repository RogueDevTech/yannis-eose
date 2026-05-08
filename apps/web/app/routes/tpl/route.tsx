import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { Outlet, useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import type { ShouldRevalidateFunction } from '@remix-run/react';
import { getCurrentUser, getSessionCookie, apiRequest } from '~/lib/api.server';
import { TplLayout } from '~/components/layout/tpl-layout';
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
    const redirectTo = url.pathname === '/tpl' ? '' : `?redirectTo=${url.pathname}`;
    return redirect(`/auth${redirectTo}`);
  }

  if (user.role !== 'TPL_MANAGER' && user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return redirect('/admin');
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

  return defer({ user, notifications: notificationsPromise });
}

/**
 * Skip re-running this TPL shell loader on every child-route navigation. See the
 * matching comment in `routes/admin/route.tsx::shouldRevalidate` for the full rationale.
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

/** Same resilience UX as `/admin` and `/hr` when a child loader throws (e.g. API restart). */
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
