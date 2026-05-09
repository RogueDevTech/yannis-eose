import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOrdersPage, type MarketingOrdersSecondaryPayload } from '~/features/marketing/MarketingOrdersPage';
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

  // Single bundle replaces 6 separate trpc calls (orders.statusCounts,
  // marketing.metrics, orders.timeSeriesByCreated, users.list, products.list,
  // marketing.listCampaigns). Same data, one HTTP request → one auth-middleware
  // pass → one session lookup, with the 6 service calls fanned out in parallel
  // server-side. See `marketing.ordersPageBundle` for the rationale.
  const bundleInput: {
    mediaBuyerId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    includeMarketingExportPicklists: boolean;
  } = { includeMarketingExportPicklists: loadMarketingExportPicklists };
  if (mediaBuyerId) bundleInput.mediaBuyerId = mediaBuyerId;
  if (status) bundleInput.status = status;
  if (startDate) bundleInput.startDate = startDate;
  if (endDate) bundleInput.endDate = endDate;
  const bundleInputStr = encodeURIComponent(JSON.stringify(bundleInput));

  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canExport =
    isAdminLevel(user) || userPerms.includes(canonicalPermissionCode('orders.export'));

  const ordersShell = {
    filters,
    isMediaBuyer,
    showMediaBuyerColumn,
    canExport,
    page,
    statusFilter: status,
    searchFilter: search,
  };

  // Defer the orders list — page chrome renders immediately, table swaps from
  // skeleton rows to real ones when this promise resolves.
  const listPromise = (async () => {
    const res = await apiRequest<unknown>(`/trpc/orders.list?input=${listInputStr}`, {
      method: 'GET',
      cookie,
    });
    const trpcData = res.ok
      ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;

    const total = trpcData?.pagination?.total ?? 0;
    const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

    const orders: Order[] = (trpcData?.orders ?? []).map((o) => ({
      ...o,
      customerPhoneDisplay: '',
    }));

    return { orders, total, totalPages };
  })();

  // Secondary streams independently — one bundled tRPC call returns counts, CPA,
  // chart series, and all three filter picklists at once.
  const secondaryPromise = (async (): Promise<MarketingOrdersSecondaryPayload> => {
    try {
      const bundleRes = await apiRequest<unknown>(
        `/trpc/marketing.ordersPageBundle?input=${bundleInputStr}`,
        { method: 'GET', cookie },
      );

      const data = bundleRes.ok
        ? (bundleRes.data as {
            result?: {
              data?: {
                statusCounts: Record<string, number>;
                metrics: { cpa: number; totalSpend: number };
                dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
                mediaBuyersForFilter: Array<{ id: string; name: string }>;
                productsForFilter: Array<{ id: string; name: string }>;
                campaignsForFilter: Array<{ id: string; name: string }>;
              };
            };
          })?.result?.data
        : null;

      const productsForFilter = data?.productsForFilter ?? [];
      const campaignsForFilter = data?.campaignsForFilter ?? [];
      const mediaBuyersForFilter = data?.mediaBuyersForFilter ?? [];

      // The export modal picks from all three picklists; only HoM/admin loaders
      // actually trigger the buyers query — so the picklist is only present when
      // the loader asked for it AND the bundle returned buyers.
      const marketingExportPicklists: Partial<ExportModalPicklists> | undefined =
        loadMarketingExportPicklists && mediaBuyersForFilter.length > 0
          ? {
              mediaBuyers: mediaBuyersForFilter,
              products: productsForFilter,
              campaigns: campaignsForFilter,
            }
          : undefined;

      return {
        statusCounts: data?.statusCounts ?? {},
        cpa: data?.metrics?.cpa ?? null,
        totalAdSpend: data?.metrics?.totalSpend ?? null,
        dailyCounts: data?.dailyCounts ?? [],
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

  return defer({
    ordersShell,
    listPromise,
    secondaryPromise,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;
  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingOrdersRoute() {
  const { ordersShell, listPromise, secondaryPromise } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_ORDERS_LIVE_EVENTS]);
  const sharedProps = {
    page: ordersShell.page,
    limit: ORDERS_PER_PAGE,
    secondary: secondaryPromise,
    statusFilter: ordersShell.statusFilter,
    searchFilter: ordersShell.searchFilter,
    isMediaBuyer: ordersShell.isMediaBuyer,
    showMediaBuyerColumn: ordersShell.showMediaBuyerColumn,
    filters: ordersShell.filters,
    liveEvents: [...MARKETING_ORDERS_LIVE_EVENTS],
    canExport: ordersShell.canExport,
  };
  return (
    <CachedAwait
      resolve={listPromise}
      fallback={
        <MarketingOrdersPage
          {...sharedProps}
          orders={[]}
          total={0}
          totalPages={0}
          deferredLoading
        />
      }
    >
      {(d) => (
        <MarketingOrdersPage
          {...sharedProps}
          orders={d.orders}
          total={d.total}
          totalPages={d.totalPages}
        />
      )}
    </CachedAwait>
  );
}
