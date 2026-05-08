import { Link, useSearchParams } from '@remix-run/react';
import { resolveNotificationsTab, type NotificationsTabId } from '~/features/notifications/notifications-tabs';

/** Matches sidebar visibility for broadcast / automation admin tools. */
const PUSH_AND_AUTOMATION_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
  'HR_MANAGER',
]);

function hrefForNotificationsTab(tab: NotificationsTabId, sp: URLSearchParams): string {
  const n = new URLSearchParams(sp);
  n.set('tab', tab);
  return `?${n.toString()}`;
}

function tabNavLinkClass(isActive: boolean): string {
  return (
    'whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ' +
    (isActive
      ? 'border-brand-500 text-brand-700 dark:text-brand-300'
      : 'border-transparent text-app-fg-muted hover:text-app-fg hover:border-app-border-strong')
  );
}

export function NotificationsTabPanelSkeleton() {
  return (
    <div
      className="min-h-[240px] rounded-xl border border-app-border bg-app-surface/40 p-4 space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-app-border/80">
        <div className="h-5 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
        <div className="h-8 w-28 rounded-lg bg-app-hover animate-pulse shrink-0" aria-hidden />
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-app-border/60 last:border-0">
          <div className="h-10 w-10 rounded-full bg-app-hover animate-pulse shrink-0" aria-hidden />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="h-4 w-full max-w-md rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-3 w-48 rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
          <div className="h-3 w-16 rounded bg-app-hover animate-pulse shrink-0" aria-hidden />
        </div>
      ))}
    </div>
  );
}

type ShellUser = { role?: string | null } | null;

/**
 * Full chrome while notification tab data streams (feed / automations / delivery log).
 */
export function NotificationsRouteLoadingShell({
  user,
  tab,
}: {
  user: ShellUser;
  tab: NotificationsTabId;
}) {
  const [searchParams] = useSearchParams();
  const role = user?.role ?? '';
  const canPushAdmin = PUSH_AND_AUTOMATION_ROLES.has(role);

  const displayTab = resolveNotificationsTab(tab, canPushAdmin);

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div>
        <h1 className="text-2xl font-bold text-app-fg">Notifications</h1>
        <p className="mt-0.5 text-sm text-app-fg-muted">
          In-app feed, broadcast push, automations, and delivery log — one place.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-4 lg:-mx-6 border-b border-app-border bg-app-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-app-canvas/80">
        <nav
          className="flex min-w-0 gap-0.5 overflow-x-auto px-4 lg:px-6 pt-1 pb-0"
          aria-label="Notifications sections"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <Link
            to={hrefForNotificationsTab('feed', searchParams)}
            className={tabNavLinkClass(displayTab === 'feed') + ' shrink-0'}
            preventScrollReset
          >
            In-app feed
          </Link>
          {canPushAdmin && (
            <>
              <Link
                to={hrefForNotificationsTab('broadcast', searchParams)}
                className={tabNavLinkClass(displayTab === 'broadcast') + ' shrink-0'}
                preventScrollReset
              >
                Broadcast push
              </Link>
              <Link
                to={hrefForNotificationsTab('automations', searchParams)}
                className={tabNavLinkClass(displayTab === 'automations') + ' shrink-0'}
                preventScrollReset
              >
                Automations
              </Link>
            </>
          )}
          {canPushAdmin && (
            <Link
              to={hrefForNotificationsTab('log', searchParams)}
              className={tabNavLinkClass(displayTab === 'log') + ' shrink-0'}
              preventScrollReset
            >
              Delivery log
            </Link>
          )}
        </nav>
      </div>

      <NotificationsTabPanelSkeleton />
    </div>
  );
}
