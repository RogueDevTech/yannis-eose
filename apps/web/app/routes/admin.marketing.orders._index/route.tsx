import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOrdersPage, type MarketingOrdersSecondaryPayload } from '~/features/marketing/MarketingOrdersPage';
import { MarketingOrdersLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type { Order } from '~/features/orders/types';
import { handleExportReportAction } from '~/lib/export-report.server';
import type { ExportModalPicklists } from '~/components/ui/export-modal';
export const meta: MetaFunction = () => [
  { title: 'Marketing Orders — Yannis EOSE' },
];

const MARKETING_ORDERS_LIVE_EVENTS = ['order:new', 'order:status_changed'] as const;

/** Fixed page size for this table (not configurable via `?limit=` — URL param ignored). */
const ORDERS_PER_PAGE = 20;

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
  const showMediaBuyerColumn =
    user.role === 'HEAD_OF_MARKETING' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const loadMarketingExportPicklists = showMediaBuyerColumn && !isMediaBuyer;

  const productIdParam = url.searchParams.get('productId') || undefined;
  const campaignIdParam = url.searchParams.get('campaignId') || undefined;
  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status || undefined,
    search: search || undefined,
    mediaBuyerId,
    productId: productIdParam,
    campaignId: campaignIdParam,
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

  const buyersInputStr = encodeURIComponent(
    JSON.stringify({ page: 1, limit: 100, role: 'MEDIA_BUYER', status: 'ACTIVE' }),
  );
  const productsInputStr = encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' }));
  const campaignsInputStr = encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' }));

  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canExport =
    isAdminLevel(user) || userPerms.includes(canonicalPermissionCode('orders.export'));

  const ordersShell = {
    filters,
    isMediaBuyer,
    showMediaBuyerColumn,
    canExport,
  };

  const pageData = (async () => {
    const listPromise = apiRequest<unknown>(`/trpc/orders.list?input=${listInputStr}`, {
      method: 'GET',
      cookie,
    });

    const secondaryPromise = (async (): Promise<MarketingOrdersSecondaryPayload> => {
      try {
        const [
          countsRes,
          metricsRes,
          trendRes,
          buyersRes,
          productsRes,
          campaignsRes,
        ] = await Promise.all([
          apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, { method: 'GET', cookie }),
          apiRequest<unknown>(`/trpc/marketing.metrics?input=${metricsInputStr}`, { method: 'GET', cookie }),
          apiRequest<unknown>(`/trpc/orders.timeSeriesByCreated?input=${trendInputStr}`, { method: 'GET', cookie }),
          loadMarketingExportPicklists
            ? apiRequest<unknown>(`/trpc/users.list?input=${buyersInputStr}`, { method: 'GET', cookie })
            : Promise.resolve(null),
          // Always load products + campaigns — Media Buyers need them for the
          // Product / Form filter dropdowns even without export access.
          apiRequest<unknown>(`/trpc/products.list?input=${productsInputStr}`, { method: 'GET', cookie }),
          apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${campaignsInputStr}`, { method: 'GET', cookie }),
        ]);

        const countsData = countsRes.ok
          ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
          : {};

        const metricsData = metricsRes.ok
          ? (metricsRes.data as { result?: { data?: { cpa: number; totalSpend: number } } })?.result?.data
          : null;

        const dailyCounts = trendRes.ok
          ? ((trendRes.data as {
              result?: { data?: Array<{ date: string; orderCount: number; deliveredCount?: number }> };
            })?.result?.data ?? [])
          : [];

        // Pull products + campaigns out for the always-on Product / Form filter dropdowns.
        const productsPayload = productsRes?.ok
          ? (productsRes.data as { result?: { data?: { products: Array<{ id: string; name: string }> } } })?.result?.data
          : null;
        const campaignsPayload = campaignsRes?.ok
          ? (campaignsRes.data as { result?: { data?: { campaigns: Array<{ id: string; name: string }> } } })?.result?.data
          : null;
        const productsForFilter = (productsPayload?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
        const campaignsForFilter = (campaignsPayload?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name }));

        let marketingExportPicklists: Partial<ExportModalPicklists> | undefined;
        if (loadMarketingExportPicklists && buyersRes?.ok && productsRes?.ok && campaignsRes?.ok) {
          const usersPayload = (buyersRes.data as { result?: { data?: { users: Array<{ id: string; name: string }> } } })?.result?.data;
          marketingExportPicklists = {
            mediaBuyers: (usersPayload?.users ?? []).map((u) => ({ id: u.id, name: u.name })),
            products: productsForFilter,
            campaigns: campaignsForFilter,
          };
        }
        const mediaBuyersForFilter = marketingExportPicklists?.mediaBuyers ?? [];

        return {
          statusCounts: countsData,
          cpa: metricsData?.cpa ?? null,
          totalAdSpend: metricsData?.totalSpend ?? null,
          dailyCounts,
          marketingExportPicklists,
          mediaBuyersForFilter,
          productsForFilter,
          campaignsForFilter,
        };
      } catch {
        return {
          statusCounts: {},
          cpa: null,
          totalAdSpend: null,
          dailyCounts: [],
          marketingExportPicklists: undefined,
          mediaBuyersForFilter: [],
          productsForFilter: [],
          campaignsForFilter: [],
        };
      }
    })();

    const [res, secondaryPayload] = await Promise.all([listPromise, secondaryPromise]);

    const trpcData = res.ok
      ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;

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
      statusFilter: status,
      searchFilter: search,
      secondary: Promise.resolve(secondaryPayload),
    };
  })();

  return defer({
    ordersShell,
    pageData,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingOrdersRoute() {
  const { ordersShell, pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_ORDERS_LIVE_EVENTS]);
  return (
    <Suspense
      fallback={
        <MarketingOrdersLoadingShell
          filters={ordersShell.filters}
          isMediaBuyer={ordersShell.isMediaBuyer}
          liveEvents={[...MARKETING_ORDERS_LIVE_EVENTS]}
          showMediaBuyerColumn={ordersShell.showMediaBuyerColumn}
        />
      }
    >
      <Await resolve={pageData}>
        {(d) => (
          <MarketingOrdersPage
            orders={d.orders}
            total={d.total}
            totalPages={d.totalPages}
            page={d.page}
            limit={d.limit}
            secondary={d.secondary}
            statusFilter={d.statusFilter}
            searchFilter={d.searchFilter}
            isMediaBuyer={ordersShell.isMediaBuyer}
            showMediaBuyerColumn={ordersShell.showMediaBuyerColumn}
            filters={ordersShell.filters}
            liveEvents={[...MARKETING_ORDERS_LIVE_EVENTS]}
            canExport={ordersShell.canExport}
          />
        )}
      </Await>
    </Suspense>
  );
}
