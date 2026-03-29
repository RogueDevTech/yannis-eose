import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { Outlet, useLoaderData, Form } from '@remix-run/react';
import { getCurrentUser } from '~/lib/api.server';
import { useOfflineSync, useOnlineStatus, usePendingCount } from '~/hooks/useOnlineStatus';
import { usePwaInstall } from '~/hooks/usePwaInstall';

export async function loader({ request }: LoaderFunctionArgs) {
  let user;
  try {
    user = await getCurrentUser(request);
  } catch {
    user = null;
  }

  if (!user) {
    return redirect('/auth');
  }

  if (user.role !== 'TPL_RIDER' && user.role !== 'SUPER_ADMIN') {
    return redirect('/admin');
  }

  return { user };
}

/**
 * Rider layout — mobile-optimized shell with no sidebar.
 * Includes offline sync, install prompt, and connection indicator.
 */
export default function RiderLayout() {
  const { user } = useLoaderData<typeof loader>();
  useOfflineSync();
  const isOnline = useOnlineStatus();
  const pendingCount = usePendingCount();
  const { canInstall, install } = usePwaInstall();

  return (
    <div className="min-h-screen bg-app-canvas">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-warning-600 text-white text-center text-xs py-1.5 px-4 font-medium">
          You are offline. Actions will sync when you reconnect.
          {pendingCount > 0 && ` (${pendingCount} pending)`}
        </div>
      )}

      {/* Pending sync indicator (online but has queued items) */}
      {isOnline && pendingCount > 0 && (
        <div className="bg-info-600 text-white text-center text-xs py-1.5 px-4 font-medium">
          Syncing {pendingCount} pending action{pendingCount !== 1 ? 's' : ''}...
        </div>
      )}

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-app-elevated border-b border-app-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
            <span className="text-xs font-bold text-white">{user.name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-app-fg leading-tight">{user.name}</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success-500' : 'bg-danger-500'}`} />
              <p className="text-2xs text-app-fg-muted">
                Rider {isOnline ? '' : '(Offline)'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canInstall && (
            <button
              onClick={install}
              className="p-2 rounded-lg text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
              title="Install App"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>
          )}
          <Form method="post" action="/auth/logout">
            <button
              type="submit"
              className="p-2 rounded-lg text-app-fg-muted hover:text-danger-500 hover:bg-app-hover transition-colors"
              title="Sign out"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </Form>
        </div>
      </header>

      <Outlet />
    </div>
  );
}
