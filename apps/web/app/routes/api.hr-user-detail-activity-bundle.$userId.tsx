import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getCurrentUser,
  getSessionCookie,
} from '~/lib/api.server';
import { actorUserIdsMatch } from '~/lib/rbac';
import type {
  UserAdjustment,
  UserAuditEntry,
  UserDetail,
  UserMarketingMetrics,
  UserOrderSummary,
  UserPayoutRecord,
} from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return json({ ok: false as const, error: 'Not authenticated' });
  }
  const cookie = getSessionCookie(request);
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );
  if (!userRes.ok) return json({ ok: false as const, error: 'User not found' });
  const profileUser =
    (userRes.data as { result?: { data?: UserDetail } })?.result?.data ?? null;
  if (!profileUser) return json({ ok: false as const, error: 'User not found' });

  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);
  const headOfCSViewingTeam =
    currentUser.role === 'HEAD_OF_CS' && ['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role);
  const headOfMarketingViewingTeam =
    currentUser.role === 'HEAD_OF_MARKETING' && ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role);
  const isHoMOrHoCS = currentUser.role === 'HEAD_OF_MARKETING' || currentUser.role === 'HEAD_OF_CS';

  if (!isSelfView && isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    return json({ ok: false as const, error: 'This user is not on your team.' }, { status: 403 });
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const orderFilter: Record<string, unknown> = { limit: 10 };
  if (['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role)) {
    orderFilter.csAgentId = userId;
  } else if (['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role)) {
    orderFilter.mediaBuyerId = userId;
  } else if (['TPL_RIDER'].includes(profileUser.role)) {
    orderFilter.riderId = userId;
  }

  const needsOrders = ['CS_AGENT', 'HEAD_OF_CS', 'MEDIA_BUYER', 'HEAD_OF_MARKETING', 'TPL_RIDER', 'HEAD_OF_LOGISTICS', 'TPL_MANAGER'].includes(profileUser.role);
  const needsPayouts = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'HEAD_OF_CS', 'CS_AGENT', 'TPL_RIDER', 'HR_MANAGER'].includes(profileUser.role);

  const [recentOrdersRes, payoutsRes, adjustmentsRes, auditRes, marketingRes] = await Promise.all([
    needsOrders
      ? apiRequest<unknown>(
          `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(orderFilter))}`,
          opt,
        )
      : Promise.resolve({ ok: true as const, data: { result: { data: { orders: [], pagination: { total: 0 } } } } }),
    needsPayouts
      ? apiRequest<unknown>(
          `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify({ staffId: userId, limit: 10 }))}`,
          opt,
        )
      : Promise.resolve({ ok: true as const, data: { result: { data: { payouts: [] } } } }),
    apiRequest<unknown>(
      `/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({ staffId: userId, limit: 10 }))}`,
      opt,
    ),
    apiRequest<unknown>(
      `/trpc/audit.globalLog?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
      opt,
    ),
    apiRequest<unknown>(
      `/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({ mediaBuyerId: userId }))}`,
      opt,
    ),
  ]);

  const recentOrdersData = recentOrdersRes.ok
    ? (recentOrdersRes.data as { result?: { data?: { orders: UserOrderSummary[]; pagination: { total: number } } } })?.result
        ?.data
    : null;

  const payouts = payoutsRes.ok
    ? ((payoutsRes.data as { result?: { data?: { payouts: UserPayoutRecord[] } } })?.result?.data?.payouts ?? [])
    : ([] as UserPayoutRecord[]);

  const adjustments = adjustmentsRes.ok
    ? ((adjustmentsRes.data as { result?: { data?: { adjustments: UserAdjustment[] } } })?.result?.data?.adjustments ??
        [])
    : ([] as UserAdjustment[]);

  const auditLog = auditRes.ok
    ? ((auditRes.data as { result?: { data?: { rows?: UserAuditEntry[] } } })?.result?.data?.rows ?? [])
    : ([] as UserAuditEntry[]);

  const marketingMetrics = marketingRes.ok
    ? ((marketingRes.data as { result?: { data?: UserMarketingMetrics } })?.result?.data ?? null)
    : null;

  return secondaryCacheJson({
    ok: true as const,
    recentOrders: { orders: recentOrdersData?.orders ?? [], total: recentOrdersData?.pagination?.total ?? 0 },
    payouts,
    adjustments,
    auditLog,
    marketingMetrics,
  });
}

