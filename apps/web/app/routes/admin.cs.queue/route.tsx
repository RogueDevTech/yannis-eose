import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CSDashboardPage } from '~/features/cs/CSDashboardPage';
import type {
  AgentWorkload,
  InactiveAgent,
  CSOrder,
  DuplicatePair,
  CSLeaderboardEntry,
} from '~/features/cs/types';

const CS_QUEUE_LIVE_EVENTS = [
  'order:new',
  'order:status_changed',
  'order:assigned',
  'order:reassigned',
  'order:assigned_bulk',
  'order:assignments_changed',
  'order:callback_due',
  'cs:duplicates_changed',
  'cart:updated',
] as const;

export const meta: MetaFunction = () => [
  { title: 'Live Activities — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cs.teamOverview');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  // ── Critical data: await these so the page always has core content ──
  const [workloadsRes, unassignedRes, statusCountsRes, activeOrdersRes] = await Promise.all([
    apiRequest<unknown>('/trpc/orders.csWorkloads', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'UNPROCESSED', limit: 50 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/orders.statusCounts', { method: 'GET', cookie }),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ status: 'CS_ENGAGED', limit: 50 }))}`,
      { method: 'GET', cookie },
    ),
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

  const criticalData = {
    workloads,
    unassignedOrders: unassignedData?.orders ?? [],
    unassignedTotal: unassignedData?.pagination?.total ?? 0,
    activeOrders: activeData?.orders ?? [],
    activeTotal: activeData?.pagination?.total ?? 0,
    statusCounts,
  };

  // ── Non-critical: deferred (stream to client) ──────────────
  const inactiveAgents: Promise<InactiveAgent[]> = apiRequest<unknown>(
    `/trpc/orders.inactiveAgents?input=${encodeURIComponent(JSON.stringify({ thresholdMinutes: 10 }))}`,
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: InactiveAgent[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  const callbackOrders: Promise<CSOrder[]> = apiRequest<unknown>(
    '/trpc/orders.scheduledCallbacks',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: CSOrder[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  const flaggedDuplicates: Promise<DuplicatePair[]> = apiRequest<unknown>(
    '/trpc/orders.flaggedDuplicates',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok
      ? (res.data as { result?: { data?: Array<{ duplicate: CSOrder; original: CSOrder | null }> } })?.result?.data ?? []
      : [],
  ).catch(() => []);

  const leaderboard: Promise<CSLeaderboardEntry[]> = apiRequest<unknown>(
    `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok ? (res.data as { result?: { data?: CSLeaderboardEntry[] } })?.result?.data ?? [] : [],
  ).catch(() => []);

  const cartStats: Promise<{ pending: number; abandonedLast24h: number }> = apiRequest<unknown>(
    '/trpc/cart.getStats?input=%7B%7D',
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok
      ? (res.data as { result?: { data?: { pending: number; abandonedLast24h: number } } })?.result?.data ?? { pending: 0, abandonedLast24h: 0 }
      : { pending: 0, abandonedLast24h: 0 },
  ).catch(() => ({ pending: 0, abandonedLast24h: 0 }));

  const pendingCarts: Promise<Array<{
    id: string;
    customerName: string;
    customerPhoneDisplay: string;
    productName: string | null;
    campaignName: string | null;
    offerLabel: string | null;
    updatedAt: string;
  }>> = apiRequest<unknown>(
    `/trpc/cart.listPending?input=${encodeURIComponent(JSON.stringify({ limit: 30 }))}`,
    { method: 'GET', cookie },
  ).then((res) =>
    res.ok
      ? (res.data as { result?: { data?: Array<{ id: string; customerName: string; customerPhoneDisplay: string; productName: string | null; campaignName: string | null; offerLabel: string | null; updatedAt: string }> } })?.result?.data ?? []
      : [],
  ).catch(() => []);

  return {
    criticalData,
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
      return json({ error: errorData?.error?.message ?? 'Assignment failed' }, { status: safeStatus(res.status) });
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
      return json({ error: errorData?.error?.message ?? 'Reassignment failed' }, { status: safeStatus(res.status) });
    }

    return json({ success: true });
  }

  if (intent === 'redistribute') {
    const res = await apiRequest<{ result?: { data?: { distributed: number } } }>(
      '/trpc/orders.distributeUnassignedOrders',
      { method: 'POST', cookie, body: {} },
    );

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Distribute order failed' }, { status: safeStatus(res.status) });
    }

    const distributed = res.data?.result?.data?.distributed ?? 0;
    return json({ success: true, distributed });
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
      return json({ error: errorData?.error?.message ?? 'Failed to schedule callback' }, { status: safeStatus(res.status) });
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
      return json({ error: errorData?.error?.message ?? 'Failed to merge orders' }, { status: safeStatus(res.status) });
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
      return json({ error: errorData?.error?.message ?? 'Failed to dismiss duplicate' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'transition') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const newStatus = formData.get('newStatus')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() || undefined;

    if (!orderId || !newStatus) {
      return json({ error: 'Order ID and new status are required' }, { status: 400 });
    }

    const body: { orderId: string; newStatus: string; metadata?: { reason: string } } = {
      orderId,
      newStatus,
    };
    if (reason) body.metadata = { reason };

    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body,
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Transition failed' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CSQueueRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...CS_QUEUE_LIVE_EVENTS]);
  return (
    <CSDashboardPage
      {...data.criticalData}
      liveEvents={[...CS_QUEUE_LIVE_EVENTS]}
      inactiveAgents={data.inactiveAgents}
      callbackOrders={data.callbackOrders}
      flaggedDuplicates={data.flaggedDuplicates}
      leaderboard={data.leaderboard}
      leaderboardPeriod={data.leaderboardPeriod as 'this_month' | 'all_time'}
      cartStats={data.cartStats}
      pendingCarts={data.pendingCarts}
    />
  );
}
