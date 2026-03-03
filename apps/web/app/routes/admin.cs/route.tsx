import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CSDashboardPage } from '~/features/cs/CSDashboardPage';
import type {
  AgentWorkload,
  InactiveAgent,
  CSOrder,
  DuplicatePair,
  CSLeaderboardEntry,
  CSDashboardStreamData,
} from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'CS Dashboard — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cs.teamOverview');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  // ── Kick off ALL fetches concurrently ──────────────────────
  const workloadsP = apiRequest<unknown>('/trpc/orders.csWorkloads', { method: 'GET', cookie });
  const unassignedP = apiRequest<unknown>(
    `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'UNPROCESSED', limit: 50 }))}`,
    { method: 'GET', cookie },
  );
  const statusCountsP = apiRequest<unknown>('/trpc/orders.statusCounts', { method: 'GET', cookie });
  const activeOrdersP = apiRequest<unknown>(
    `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'CS_ENGAGED', limit: 50 }))}`,
    { method: 'GET', cookie },
  );

  // Non-critical — these will stream to the client
  const inactiveP = apiRequest<unknown>(
    `/trpc/orders.inactiveAgents?input=${encodeURIComponent(JSON.stringify({ thresholdMinutes: 10 }))}`,
    { method: 'GET', cookie },
  );
  const callbacksP = apiRequest<unknown>('/trpc/orders.scheduledCallbacks', { method: 'GET', cookie });
  const duplicatesP = apiRequest<unknown>('/trpc/orders.flaggedDuplicates', { method: 'GET', cookie });
  const leaderboardP = apiRequest<unknown>(
    `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  );
  const cartStatsP = apiRequest<unknown>('/trpc/cart.getStats?input=%7B%7D', { method: 'GET', cookie });
  const pendingCartsP = apiRequest<unknown>(
    `/trpc/cart.listPending?input=${encodeURIComponent(JSON.stringify({ limit: 30 }))}`,
    { method: 'GET', cookie },
  );

  // ── Await only the critical data ───────────────────────────
  const [workloadsRes, unassignedRes, statusCountsRes, activeOrdersRes] = await Promise.all([
    workloadsP,
    unassignedP,
    statusCountsP,
    activeOrdersP,
  ]);

  const workloads = workloadsRes.ok
    ? (workloadsRes.data as { result?: { data?: AgentWorkload[] } })?.result?.data ?? []
    : [];

  const unassignedData = unassignedRes.ok
    ? (unassignedRes.data as { result?: { data?: { orders: CSOrder[]; pagination: { total: number } } } })?.result?.data
    : null;

  const activeData = activeOrdersRes.ok
    ? (activeOrdersRes.data as { result?: { data?: { orders: CSOrder[]; pagination: { total: number } } } })?.result?.data
    : null;

  const statusCounts = statusCountsRes.ok
    ? (statusCountsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};

  // ── Deferred promises (un-awaited, with .catch fallbacks) ──
  const inactiveAgents: Promise<InactiveAgent[]> = inactiveP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: InactiveAgent[] } })?.result?.data ?? []
        : [],
    )
    .catch(() => []);

  const callbackOrders: Promise<CSOrder[]> = callbacksP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: CSOrder[] } })?.result?.data ?? []
        : [],
    )
    .catch(() => []);

  const flaggedDuplicates: Promise<DuplicatePair[]> = duplicatesP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: Array<{ duplicate: CSOrder; original: CSOrder | null }> } })?.result?.data ?? []
        : [],
    )
    .catch(() => []);

  const leaderboard: Promise<CSLeaderboardEntry[]> = leaderboardP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: CSLeaderboardEntry[] } })?.result?.data ?? []
        : [],
    )
    .catch(() => []);

  const cartStats: Promise<{ pending: number; abandonedLast24h: number }> = cartStatsP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: { pending: number; abandonedLast24h: number } } })?.result?.data ?? { pending: 0, abandonedLast24h: 0 }
        : { pending: 0, abandonedLast24h: 0 },
    )
    .catch(() => ({ pending: 0, abandonedLast24h: 0 }));

  const pendingCarts: Promise<Array<{
    id: string;
    customerName: string;
    customerPhoneDisplay: string;
    productName: string | null;
    campaignName: string | null;
    offerLabel: string | null;
    updatedAt: string;
  }>> = pendingCartsP
    .then((res) =>
      res.ok
        ? (res.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
        : [],
    )
    .catch(() => []);

  // v3_singleFetch: return plain object — un-awaited promises stream automatically
  return {
    workloads,
    unassignedOrders: unassignedData?.orders ?? [],
    unassignedTotal: unassignedData?.pagination?.total ?? 0,
    activeOrders: activeData?.orders ?? [],
    activeTotal: activeData?.pagination?.total ?? 0,
    statusCounts,
    inactiveAgents,
    callbackOrders,
    flaggedDuplicates,
    leaderboard,
    leaderboardPeriod,
    cartStats,
    pendingCarts,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'assign') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const csAgentId = formData.get('csAgentId')?.toString() ?? '';

    if (!orderId || !csAgentId) {
      return json({ error: 'Order ID and agent ID are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.assignToCS', {
      method: 'POST',
      cookie,
      body: { orderId, csAgentId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Assignment failed' }, { status: res.status });
    }

    return json({ success: true });
  }

  if (intent === 'bulkReassign') {
    const orderIdsRaw = formData.get('orderIds')?.toString() ?? '[]';
    const fromAgentId = formData.get('fromAgentId')?.toString() ?? '';
    const toAgentId = formData.get('toAgentId')?.toString() ?? '';

    let orderIds: string[];
    try {
      orderIds = JSON.parse(orderIdsRaw) as string[];
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }

    if (orderIds.length === 0 || !fromAgentId || !toAgentId) {
      return json({ error: 'Must select orders and both agents' }, { status: 400 });
    }

    if (fromAgentId === toAgentId) {
      return json({ error: 'Cannot reassign to the same agent' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.bulkReassign', {
      method: 'POST',
      cookie,
      body: { orderIds, fromAgentId, toAgentId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Reassignment failed' }, { status: res.status });
    }

    return json({ success: true });
  }

  if (intent === 'scheduleCallback') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const delayMinutes = parseInt(formData.get('delayMinutes')?.toString() ?? '120', 10);
    const notes = formData.get('notes')?.toString() || undefined;

    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.scheduleCallback', {
      method: 'POST',
      cookie,
      body: { orderId, delayMinutes, notes },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to schedule callback' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'mergeDuplicate') {
    const duplicateId = formData.get('duplicateId')?.toString() ?? '';
    const originalId = formData.get('originalId')?.toString() ?? '';

    if (!duplicateId || !originalId) {
      return json({ error: 'Both order IDs required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.mergeDuplicate', {
      method: 'POST',
      cookie,
      body: { duplicateId, originalId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to merge orders' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'dismissDuplicate') {
    const orderId = formData.get('orderId')?.toString() ?? '';

    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/orders.dismissDuplicate', {
      method: 'POST',
      cookie,
      body: { orderId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to dismiss duplicate' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CSDashboardRoute() {
  const data = useLoaderData<typeof loader>() as CSDashboardStreamData;
  usePageRefreshOnEvent(['order:new', 'order:status_changed', 'order:assigned']);
  return <CSDashboardPage {...data} />;
}
