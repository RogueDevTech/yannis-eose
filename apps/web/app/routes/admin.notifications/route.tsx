import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import {
  useLoaderData,
  useSearchParams,
  useLocation,
  Link,
  useNavigate,
  useNavigation,
} from '@remix-run/react';
import { useEffect } from 'react';
import { CachedAwait } from '~/components/ui/cached-await';
import { apiRequest, getSessionCookie, getCurrentUser, parsePerPage } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { NotificationsPage } from '~/features/notifications/NotificationsPage';
import type { Notification } from '~/features/notifications/types';
import { NotificationsBroadcastPanel } from '~/features/notifications/panels/NotificationsBroadcastPanel';
import {
  NotificationsAutomationsPanel,
  type AutomationRule,
} from '~/features/notifications/panels/NotificationsAutomationsPanel';
import {
  NotificationsDeliveryLogPanel,
  type DeliveryLogEntry,
  type DeliveryLogPagination,
} from '~/features/notifications/panels/NotificationsDeliveryLogPanel';
import { NotificationsTabPanelSkeleton } from '~/features/notifications/NotificationsLoadingShell';
import { resolveNotificationsTab, type NotificationsTabId } from '~/features/notifications/notifications-tabs';

export const meta: MetaFunction = () => [{ title: 'Notifications — Yannis EOSE' }];

/** Matches sidebar visibility for broadcast / automation admin tools. */
const PUSH_AND_AUTOMATION_ROLES = new Set([
  'SUPER_ADMIN', 'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
  'HR_MANAGER',
]);

interface UserSearchResult {
  id: string;
  name: string;
  email: string;
  role: string;
  hasPushSubscription: boolean;
}

interface FeedListResult {
  notifications: Notification[];
  unreadCount: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const EMPTY_FEED: FeedListResult = {
  notifications: [],
  unreadCount: 0,
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);
  const role = user?.role ?? '';
  const canPushAdmin = PUSH_AND_AUTOMATION_ROLES.has(role);

  // User search for broadcast "One user" picker — returns early (consumed by useFetcher only)
  const intent = url.searchParams.get('intent');
  if (intent === 'searchUsers') {
    const q = url.searchParams.get('q')?.trim() ?? '';
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));
    const input = encodeURIComponent(JSON.stringify({ q, limit, offset }));
    const res = await apiRequest<{ result?: { data?: { users: UserSearchResult[] } } }>(
      `/trpc/users.searchForPushTarget?input=${input}`,
      { method: 'GET', cookie },
    );
    return json({ users: res.ok ? (res.data?.result?.data?.users ?? []) : [] as UserSearchResult[] });
  }

  const requestedRaw = url.searchParams.get('tab');
  const tab = resolveNotificationsTab(requestedRaw, canPushAdmin);

  if (requestedRaw !== null && requestedRaw !== tab) {
    const next = new URL(request.url);
    next.searchParams.set('tab', tab);
    return redirect(`${next.pathname}?${next.searchParams.toString()}`);
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  // URL-driven page size — clamped to [20, 50, 100]; the `<Pagination>` per-page picker writes `perPage`.
  const { perPage: limit } = parsePerPage(url.searchParams);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
  const feedInput = encodeURIComponent(JSON.stringify({ page, limit, unreadOnly }));

  const logStatus = url.searchParams.get('logStatus') ?? '';
  const logTrigger = url.searchParams.get('logTrigger') ?? '';
  const logFrom = url.searchParams.get('logFrom') ?? '';
  const logTo = url.searchParams.get('logTo') ?? '';
  const logPage = Math.max(1, parseInt(url.searchParams.get('logPage') ?? '1', 10));
  const { perPage: logLimit } = parsePerPage(url.searchParams, { param: 'logPerPage' });
  const logInput = encodeURIComponent(
    JSON.stringify({
      status: logStatus || undefined,
      triggerType: logTrigger || undefined,
      dateFrom: logFrom || undefined,
      dateTo: logTo || undefined,
      page: logPage,
      limit: logLimit,
    }),
  );

  const emptyLogBundle = {
    logs: [] as DeliveryLogEntry[],
    logPagination: {
      page: 1,
      limit: logLimit,
      total: 0,
      totalPages: 0,
    } satisfies DeliveryLogPagination,
  };

  // Fallback feed reflects the resolved page size so the per-page picker shows the right value.
  const emptyFeed: FeedListResult = {
    ...EMPTY_FEED,
    pagination: { ...EMPTY_FEED.pagination, page, limit },
  };

  const feedPromise: Promise<FeedListResult> =
    tab === 'feed' && user
      ? apiRequest<{ result?: { data?: FeedListResult } }>(
          `/trpc/notifications.list?input=${feedInput}`,
          { method: 'GET', cookie },
        ).then((feedRes) => {
          if (feedRes.ok && feedRes.data?.result?.data) return feedRes.data.result.data;
          return emptyFeed;
        })
      : Promise.resolve(emptyFeed);

  const rulesPromise: Promise<AutomationRule[]> =
    tab === 'automations'
      ? apiRequest<{ result?: { data?: AutomationRule[] } }>(
          '/trpc/notifications.getAutomationRules',
          { method: 'GET', cookie },
        ).then((rulesRes) => (rulesRes.ok ? (rulesRes.data?.result?.data ?? []) : []))
      : Promise.resolve([]);

  const logBundlePromise: Promise<{ logs: DeliveryLogEntry[]; logPagination: DeliveryLogPagination }> =
    tab === 'log'
      ? apiRequest<{
          result?: { data?: { logs: DeliveryLogEntry[]; pagination: DeliveryLogPagination } };
        }>(`/trpc/notifications.getPushDeliveryLog?input=${logInput}`, { method: 'GET', cookie }).then(
          (logRes) => {
            if (logRes.ok && logRes.data?.result?.data) {
              return {
                logs: logRes.data.result.data.logs,
                logPagination: logRes.data.result.data.pagination,
              };
            }
            return emptyLogBundle;
          },
        )
      : Promise.resolve(emptyLogBundle);

  return defer({
    notificationsShell: { user, tab },
    pageData: (async () => {
      const [feed, rules, logBundle] = await Promise.all([feedPromise, rulesPromise, logBundlePromise]);
      return { feed, rules, logBundle };
    })(),
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'broadcast') {
    const targetType = formData.get('targetType')?.toString();
    const targetRole = formData.get('targetRole')?.toString() || undefined;
    const targetUserId = formData.get('targetUserId')?.toString() || undefined;
    const title = formData.get('title')?.toString()?.trim();
    const body = formData.get('body')?.toString()?.trim();

    if (!targetType) return json({ error: 'Target type is required.' }, { status: 400 });
    if (!title) return json({ error: 'Title is required.' }, { status: 400 });
    if (!body) return json({ error: 'Body is required.' }, { status: 400 });
    if (title.length > 80) return json({ error: 'Title must be 80 characters or fewer.' }, { status: 400 });
    if (body.length > 120) return json({ error: 'Body must be 120 characters or fewer.' }, { status: 400 });
    if (targetType === 'ROLE' && !targetRole)
      return json({ error: 'Please select a role.' }, { status: 400 });
    if (targetType === 'USER' && !targetUserId)
      return json({ error: 'Please enter a User ID.' }, { status: 400 });

    const res = await apiRequest<{
      result?: { data?: { recipientCount?: number; pushDeliveryCount?: number } };
    }>('/trpc/notifications.broadcastPush', {
      method: 'POST',
      cookie,
      body: { targetType, targetRole, targetUserId, title, body },
    });

    if (!res.ok) {
      // tRPC v11 error response is an array: [{ error: { json: { message } } }]
      const raw = res.data as unknown;
      console.error('[broadcast] API error status=%d body=%j', res.status, raw);
      let msg = 'Failed to send notification. Please try again.';
      if (Array.isArray(raw) && raw[0]?.error?.json?.message) {
        msg = raw[0].error.json.message as string;
      } else if (Array.isArray(raw) && raw[0]?.error?.message) {
        msg = raw[0].error.message as string;
      } else if (raw && typeof raw === 'object' && 'error' in raw) {
        msg = (raw as { error?: { message?: string } }).error?.message ?? msg;
      }
      return json({ error: msg }, { status: 400 });
    }

    const recipientCount = res.data?.result?.data?.recipientCount ?? 0;
    const pushDeliveryCount = res.data?.result?.data?.pushDeliveryCount ?? 0;
    return json({ success: true, recipientCount, pushDeliveryCount });
  }

  if (intent === 'create') {
    const payload = buildAutomationPayloadFromForm(formData);
    const res = await apiRequest('/trpc/notifications.createAutomationRule', {
      method: 'POST',
      cookie,
      body: payload,
    });
    if (!res.ok) return json({ error: 'Failed to create rule.' }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'update') {
    const id = formData.get('id')?.toString();
    const payload = buildAutomationPayloadFromForm(formData);
    const res = await apiRequest('/trpc/notifications.updateAutomationRule', {
      method: 'POST',
      cookie,
      body: { id, ...payload },
    });
    if (!res.ok) return json({ error: 'Failed to update rule.' }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'toggle') {
    const id = formData.get('id')?.toString();
    const isActive = formData.get('isActive') === 'true';
    const res = await apiRequest('/trpc/notifications.toggleAutomationRule', {
      method: 'POST',
      cookie,
      body: { id, isActive },
    });
    if (!res.ok) return json({ error: 'Failed to toggle rule.' }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'delete') {
    const id = formData.get('id')?.toString();
    const res = await apiRequest('/trpc/notifications.deleteAutomationRule', {
      method: 'POST',
      cookie,
      body: { id },
    });
    if (!res.ok) return json({ error: 'Failed to delete rule.' }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'resend') {
    const logId = formData.get('logId')?.toString();
    const res = await apiRequest('/trpc/notifications.resendPush', {
      method: 'POST',
      cookie,
      body: { logId },
    });
    if (!res.ok) return json({ error: 'Failed to resend.' }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'bulkResend') {
    const raw = formData.get('logIds')?.toString() ?? '[]';
    let logIds: string[];
    try {
      logIds = JSON.parse(raw) as string[];
    } catch {
      return json({ error: 'Invalid logIds.' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/notifications.bulkResendPush', {
      method: 'POST',
      cookie,
      body: { logIds },
    });
    if (!res.ok) return json({ error: 'Failed to bulk resend.' }, { status: 400 });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

function buildAutomationPayloadFromForm(formData: FormData) {
  const triggerType = formData.get('triggerType')?.toString() as 'SCHEDULED' | 'EVENT_BASED';
  const schedulePreset = (formData.get('schedulePreset')?.toString() ?? 'daily') as
    | 'daily'
    | 'monday'
    | 'weekday'
    | 'custom';
  const scheduleTime = formData.get('scheduleTime')?.toString() ?? '09:00';
  const customCron = formData.get('customCron')?.toString() ?? '';

  let cronExpression: string | null = null;
  if (triggerType === 'SCHEDULED') {
    cronExpression =
      schedulePreset === 'custom'
        ? customCron
        : buildCronFromPreset(schedulePreset, scheduleTime);
  }

  return {
    name: formData.get('name')?.toString(),
    triggerType,
    cronExpression,
    eventTrigger: triggerType === 'EVENT_BASED' ? formData.get('eventTrigger')?.toString() : null,
    targetType: formData.get('targetType')?.toString(),
    targetRole: formData.get('targetRole')?.toString() || null,
    targetUserId: formData.get('targetUserId')?.toString() || null,
    titleTemplate: formData.get('titleTemplate')?.toString(),
    bodyTemplate: formData.get('bodyTemplate')?.toString(),
  };
}

function buildCronFromPreset(
  preset: 'daily' | 'monday' | 'weekday' | 'custom',
  time: string,
): string {
  const [h = '9', m = '0'] = time.split(':');
  const hour = parseInt(h, 10);
  const min = parseInt(m, 10);
  switch (preset) {
    case 'daily':
      return `${min} ${hour} * * *`;
    case 'monday':
      return `${min} ${hour} * * 1`;
    case 'weekday':
      return `${min} ${hour} * * 1-5`;
    default:
      return `${min} ${hour} * * *`;
  }
}

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

/** Tab shown in UI while a GET navigation is in flight (instant highlight). */
function resolveDisplayNotificationsTab(
  navState: 'idle' | 'loading' | 'submitting',
  navLocation: { search: string } | null | undefined,
  committedTab: NotificationsTabId,
  canPushAdmin: boolean,
): NotificationsTabId {
  if (navState === 'idle' || !navLocation) {
    return committedTab;
  }
  const pending = new URLSearchParams(navLocation.search).get('tab');
  return resolveNotificationsTab(pending, canPushAdmin);
}

const LEGACY_HASH_TO_TAB: Record<string, NotificationsTabId> = {
  'notifications-feed': 'feed',
  'notifications-broadcast': 'broadcast',
  'notifications-automations': 'automations',
  'notifications-delivery-log': 'log',
};

export default function AdminNotificationsRoute() {
  const rawData = useLoaderData<typeof loader>();
  if ('users' in rawData) return null;

  const { notificationsShell, pageData } = rawData;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  const role = notificationsShell.user?.role ?? '';
  const canPushAdmin = PUSH_AND_AUTOMATION_ROLES.has(role);
  const displayTab = resolveDisplayNotificationsTab(
    navigation.state,
    navigation.location,
    notificationsShell.tab,
    canPushAdmin,
  );

  useEffect(() => {
    if (searchParams.get('tab')) return;
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return;
    const mapped = LEGACY_HASH_TO_TAB[raw];
    if (!mapped) return;
    const next = new URLSearchParams(location.search);
    next.set('tab', mapped);
    navigate(`${location.pathname}?${next.toString()}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, searchParams]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        mobileInlineActions
        description="Manage alerts and delivery logs."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Notification tools"
            desktop={<PageRefreshButton />}
          />
        }
      />

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

      <CachedAwait
        resolve={pageData}
        fallback={<NotificationsTabPanelSkeleton />}
        loaderShell={{ notificationsShell }}
        deferredKey="pageData"
      >
        {({ feed, rules, logBundle }) => (
          <div>
            {displayTab === 'feed' && (
              <div className="space-y-4">
                <NotificationsPage
                  notifications={feed.notifications as Notification[]}
                  unreadCount={feed.unreadCount}
                  pagination={feed.pagination}
                  unreadOnlyFilter={unreadOnly}
                  listRouteSearch={{ tab: 'feed' }}
                  embeddedInTabs
                />
              </div>
            )}

            {displayTab === 'broadcast' && canPushAdmin && notificationsShell.user && (
              <NotificationsBroadcastPanel actorRole={notificationsShell.user.role ?? ''} />
            )}

            {displayTab === 'automations' && canPushAdmin && (
              <NotificationsAutomationsPanel rules={rules} />
            )}

            {displayTab === 'log' && (
              <NotificationsDeliveryLogPanel
                logs={logBundle.logs}
                pagination={logBundle.logPagination}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
              />
            )}
          </div>
        )}
      </CachedAwait>
    </div>
  );
}
