import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
} from '~/lib/api.server';

const LOGISTICS_STATUS_SCOPE = [
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'REMITTED',
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const isTplManager = user.role === 'TPL_MANAGER';
  const effectiveLogisticsLocationId =
    isTplManager && user.logisticsLocationId ? user.logisticsLocationId : undefined;

  const status = url.searchParams.get('status') || 'ALL';
  const scopedStatuses = status === 'ALL' ? [...LOGISTICS_STATUS_SCOPE] : undefined;

  const periodAllTime = url.searchParams.get('periodAllTime') === 'true';
  const startDate = !periodAllTime ? (url.searchParams.get('startDate') ?? undefined) : undefined;
  const endDate = !periodAllTime ? (url.searchParams.get('endDate') ?? undefined) : undefined;

  const trendInput: {
    logisticsLocationId?: string;
    status?: string;
    statuses?: readonly string[];
    startDate?: string;
    endDate?: string;
  } = {};
  if (effectiveLogisticsLocationId) trendInput.logisticsLocationId = effectiveLogisticsLocationId;
  if (status !== 'ALL') trendInput.status = status;
  if (scopedStatuses) trendInput.statuses = scopedStatuses;
  if (startDate) trendInput.startDate = startDate;
  if (endDate) trendInput.endDate = endDate;

  const res = await apiRequest<unknown>(
    `/trpc/orders.timeSeriesByCreated?input=${encodeURIComponent(JSON.stringify(trendInput))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  const dailyCounts = res.ok
    ? ((res.data as {
        result?: { data?: Array<{ date: string; orderCount: number; deliveredCount?: number }> };
      })?.result?.data ?? [])
    : [];

  return json({
    ok: res.ok as boolean,
    dailyCounts,
    error: res.ok ? null : 'Could not load chart trend.',
  });
}

