import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOrdersPage } from '~/features/marketing/MarketingOrdersPage';
import type { Order } from '~/features/orders/types';
import { handleExportReportAction } from '~/lib/export-report.server';

export const meta: MetaFunction = () => [
  { title: 'Marketing Orders — Yannis EOSE' },
];

const MARKETING_ORDERS_LIVE_EVENTS = ['order:new', 'order:status_changed'] as const;

const ORDERS_PER_PAGE = 40;

const getDefaultThisMonthRange = defaultThisMonthRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.orders');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const mediaBuyerIdParam = url.searchParams.get('mediaBuyerId') || undefined;

  // Date filter — default to this month when no params
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const def = getDefaultThisMonthRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const isMediaBuyer = user.role === 'MEDIA_BUYER';
  const mediaBuyerId = isMediaBuyer ? user.id : mediaBuyerIdParam;

  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status || undefined,
    search: search || undefined,
    mediaBuyerId,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));
  const countsInput: { mediaBuyerId?: string; startDate?: string; endDate?: string } = mediaBuyerId ? { mediaBuyerId } : {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;
  const countsInputStr = encodeURIComponent(JSON.stringify(countsInput));

  const metricsInput: { mediaBuyerId?: string; startDate?: string; endDate?: string } = {};
  if (mediaBuyerId) metricsInput.mediaBuyerId = mediaBuyerId;
  if (startDate) metricsInput.startDate = startDate;
  if (endDate) metricsInput.endDate = endDate;
  const metricsInputStr = encodeURIComponent(JSON.stringify(metricsInput));

  // Daily-counts series for the "Orders over time" trend line on the chart view. Mirrors
  // the same scope filters as the table so the trend matches what the user is reading.
  const trendInput: { mediaBuyerId?: string; status?: string; startDate?: string; endDate?: string } = {};
  if (mediaBuyerId) trendInput.mediaBuyerId = mediaBuyerId;
  if (status) trendInput.status = status;
  if (startDate) trendInput.startDate = startDate;
  if (endDate) trendInput.endDate = endDate;
  const trendInputStr = encodeURIComponent(JSON.stringify(trendInput));

  const [res, countsRes, metricsRes, trendRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${listInputStr}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/marketing.metrics?input=${metricsInputStr}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.timeSeriesByCreated?input=${trendInputStr}`, { method: 'GET', cookie }),
  ]);

  const trpcData = res.ok
    ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;

  const countsData = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};

  const metricsData = metricsRes.ok
    ? (metricsRes.data as { result?: { data?: { cpa: number; totalSpend: number } } })?.result?.data
    : null;

  const dailyCounts = trendRes.ok
    ? ((trendRes.data as { result?: { data?: Array<{ date: string; orderCount: number }> } })?.result?.data ?? [])
    : [];

  const total = trpcData?.pagination?.total ?? 0;
  const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  const orders: Order[] = (trpcData?.orders ?? []).map((o) => ({
    ...o,
    customerPhoneDisplay: '',
  }));

  return {
    orders,
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusCounts: countsData,
    statusFilter: status,
    searchFilter: search,
    isMediaBuyer,
    showMediaBuyerColumn: user.role === 'HEAD_OF_MARKETING' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    filters,
    cpa: metricsData?.cpa ?? null,
    totalAdSpend: metricsData?.totalSpend ?? null,
    dailyCounts,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  const { filters, ...pageData } = data;
  usePageRefreshOnEvent([...MARKETING_ORDERS_LIVE_EVENTS]);
  return (
    <MarketingOrdersPage
      {...pageData}
      filters={filters}
      liveEvents={[...MARKETING_ORDERS_LIVE_EVENTS]}
    />
  );
}
