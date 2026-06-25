import { json, defer, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, parsePerPage, requirePermission, defaultTodayRange } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOrdersPage, type MarketingOrdersSecondaryPayload } from '~/features/marketing/MarketingOrdersPage';
import type { Order } from '~/features/orders/types';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import type { ExportModalPicklists } from '~/components/ui/export-modal';
export const meta: MetaFunction = () => [
  { title: 'Marketing Orders — Yannis EOSE' },
];

// `cart:updated` is included so the "Open carts" KPI revalidates live when a
// cart is captured, abandoned by the cron, or recovered — without it the stat
// only refreshed on a manual reload.
const MARKETING_ORDERS_LIVE_EVENTS = ['order:new', 'order:status_changed', 'order:assigned', 'cart:updated'] as const;

const getDefaultTodayRange = defaultTodayRange;

/** Fallback secondary data for pagination-only loads (page > 1).
 *  Stats/charts/picklists don't change with page — the component keeps
 *  the values from the page-1 load via React state. */
const EMPTY_SECONDARY: MarketingOrdersSecondaryPayload = {
  statusCounts: {},
  cpa: null,
  totalAdSpend: null,
  metrics: { totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0, totalSpend: 0 },
  dailyCounts: [],
  mediaBuyersForFilter: [],
  productsForFilter: [],
  campaignsForFilter: [],
  abandonedCartCount: 0,
  offlineCount: 0,
  duplicateCount: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.orders');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  // URL-driven page size — clamped to allowed set; default 50.
  const { perPage: ORDERS_PER_PAGE } = parsePerPage(url.searchParams, { defaultPerPage: 100 });
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const mediaBuyerIdParam = url.searchParams.get('mediaBuyerId') || undefined;
  // Cart-abandonment pseudo-filter — `?fromCart=1` swaps the orders table for
  // the abandoned-cart backlog (Media Buyers see only their own campaigns'
  // carts; the backend `cart.listAbandoned` auto-scopes them).
  const fromCart = url.searchParams.get('fromCart') === '1';
  const testOrders = url.searchParams.get('testOrders') === '1' && isAdminLevel(user);

  // Date filter — default to today when no params
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  // Optional time-of-day refinement from `<DateFilterBar>` (HH:MM, 24-hour).
  // When present, we combine date+time into an ISO datetime before sending to the
  // API so the EOD bump (which would otherwise stretch the window to 23:59) is
  // skipped. Validators still accept the bare date format for back-compat.
  let startTime = url.searchParams.get('startTime') ?? undefined;
  let endTime = url.searchParams.get('endTime') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const def = getDefaultTodayRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
    startTime = undefined;
    endTime = undefined;
  }
  // Normalise: a time without a matching date is meaningless.
  if (!startDate) startTime = undefined;
  if (!endDate) endTime = undefined;
  /** Compose an ISO datetime when time is present so the API sees an exact moment.
   *  Otherwise return the bare YYYY-MM-DD which the API expands to whole-day bounds. */
  const composeBound = (date: string | undefined, time: string | undefined): string | undefined => {
    if (!date) return undefined;
    if (!time) return date;
    return `${date}T${time}:00`;
  };
  const apiStartDate = composeBound(startDate, startTime);
  const apiEndDate = composeBound(endDate, endTime);
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', startTime: startTime ?? '', endTime: endTime ?? '', periodAllTime };

  // Marketing team supervisors get the My/Team toggle; Head of Marketing gets
  // the same toggle so they can drill into their own activity vs the full team.
  // HoM's "My Orders" filters to mediaBuyerId=self (orders they placed when
  // they were also acting as a buyer — zero if they never did, which is fine).
  const isMarketingSupervisor =
    user.role === 'HEAD_OF_MARKETING' ||
    (user.role === 'MEDIA_BUYER' && user.isMarketingTeamSupervisorOnActiveBranch === true);
  const isMediaBuyer = user.role === 'MEDIA_BUYER' && !isMarketingSupervisor;
  const mediaBuyerId = isMediaBuyer ? user.id : mediaBuyerIdParam;
  const showMediaBuyerColumn =
    user.role === 'HEAD_OF_MARKETING' ||
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'SUPPORT' ||
    isMarketingSupervisor;
  const loadMarketingExportPicklists = showMediaBuyerColumn && !isMediaBuyer;

  const productIdParam = url.searchParams.get('productId') || undefined;
  const campaignIdParam = url.searchParams.get('campaignId') || undefined;
  // Six-bucket collapse: "Confirmed" rolls up AGENT_ASSIGNED / DISPATCHED /
  // IN_TRANSIT; "Delivered" rolls up REMITTED for marketing surfaces.
  const expandConfirmedFilter = status === 'CONFIRMED';
  const expandDeliveredFilter = status === 'DELIVERED';
  const expandedStatuses = expandConfirmedFilter
    ? ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT']
    : expandDeliveredFilter
      ? ['DELIVERED', 'REMITTED']
      : null;
  const sortBy = url.searchParams.get('sortBy') || 'createdAt';
  const sortOrder = url.searchParams.get('sortOrder') || 'desc';
  const orderSourceParam = url.searchParams.get('orderSource') as 'offline' | 'edge-form' | null;
  const orderSource = orderSourceParam === 'offline' || orderSourceParam === 'edge-form' ? orderSourceParam : undefined;

  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    ...(expandedStatuses
      ? { statuses: expandedStatuses }
      : { status: status || undefined }),
    search: search || undefined,
    sortBy,
    sortOrder,
    mediaBuyerId,
    productId: productIdParam,
    campaignId: campaignIdParam,
    branchScope: 'marketing' as const,
    ...(apiStartDate && { startDate: apiStartDate }),
    ...(apiEndDate && { endDate: apiEndDate }),
    ...(testOrders && { testOrders: true }),
    // Marketing only shows edge-form orders — offline orders affect Sales only.
    // When an explicit orderSource filter is active (rare), honour it; otherwise
    // default to edge-form so offline orders never appear on this page.
    orderSource: orderSource ?? 'edge-form',
  };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));

  // Single bundle replaces 6 separate trpc calls (orders.statusCounts,
  // marketing.metrics, orders.timeSeriesByCreated, users.list, products.list,
  // marketing.listCampaigns). Same data, one HTTP request → one auth-middleware
  // pass → one session lookup, with the 6 service calls fanned out in parallel
  // server-side. See `marketing.ordersPageBundle` for the rationale.
  // The "team" bundle always shows the team-wide aggregate — when a supervisor
  // selects "My Performance" the URL gains `mediaBuyerId=self` which scopes the
  // table rows, but the stat strip reads from the pre-fetched personal bundle
  // instead. Non-supervisors (plain MB, admin) keep the URL-driven mediaBuyerId
  // so their single stat strip matches the table.
  const teamBundleMedioBuyerId = isMarketingSupervisor ? undefined : mediaBuyerId;
  const bundleInput: {
    mediaBuyerId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    includeMarketingExportPicklists: boolean;
  } = { includeMarketingExportPicklists: loadMarketingExportPicklists };
  if (teamBundleMedioBuyerId) bundleInput.mediaBuyerId = teamBundleMedioBuyerId;
  if (status) bundleInput.status = status;
  if (apiStartDate) bundleInput.startDate = apiStartDate;
  if (apiEndDate) bundleInput.endDate = apiEndDate;
  const bundleInputStr = encodeURIComponent(JSON.stringify(bundleInput));

  // Supervisors + HoM get both team stats AND personal stats pre-fetched so
  // the My/Team toggle can switch the stat strip instantly (no network round-trip).
  // The personal bundle scopes to mediaBuyerId=self (orders they placed as a buyer).
  const personalBundleInput = isMarketingSupervisor
    ? {
        mediaBuyerId: user.id,
        includeMarketingExportPicklists: false,
        ...(status ? { status } : {}),
        ...(apiStartDate ? { startDate: apiStartDate } : {}),
        ...(apiEndDate ? { endDate: apiEndDate } : {}),
      }
    : null;
  const personalBundleInputStr = personalBundleInput
    ? encodeURIComponent(JSON.stringify(personalBundleInput))
    : null;

  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canExport =
    isAdminLevel(user) || userPerms.includes(canonicalPermissionCode('orders.export'));

  const ordersShell = {
    filters,
    isMediaBuyer,
    isMarketingSupervisor,
    showMediaBuyerColumn,
    canExport,
    page,
    perPage: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search,
    sortBy,
    sortOrder,
    viewerUserId: user.id,
    activeMediaBuyerFilter: mediaBuyerId ?? null,
    enableTestOrdersOption:
      isAdminLevel(user) ||
      user.role === 'HEAD_OF_MARKETING' ||
      user.isMarketingTeamSupervisorOnActiveBranch === true,
    enableFromCartStatusOption: true,
    isCartAbandonmentView: fromCart,
  };

  // Defer the orders list — page chrome renders immediately, table swaps from
  // skeleton rows to real ones when this promise resolves.
  // Cart-abandonment view: swap for the abandoned-cart backlog instead.
  const listPromise = (async () => {
    if (fromCart) {
      const cartsInput = encodeURIComponent(
        JSON.stringify({
          page,
          limit: ORDERS_PER_PAGE,
          ...(search ? { search } : {}),
          ...(apiStartDate ? { startDate: apiStartDate } : {}),
          ...(apiEndDate ? { endDate: apiEndDate } : {}),
          ...(mediaBuyerId ? { mediaBuyerId } : {}),
        }),
      );
      const cartsRes = await apiRequest<unknown>(`/trpc/cartOrders.list?input=${cartsInput}`, {
        method: 'GET',
        cookie,
      });
      type CartOrder = {
        id: string;
        orderNumber: number;
        customerName: string;
        status: string;
        totalAmount: string | null;
        createdAt: string;
        assignedCsId: string | null;
        assignedCsName: string | null;
        mediaBuyerId: string | null;
        mediaBuyerName: string | null;
        campaignId: string | null;
        campaignName: string | null;
        orderItems: Array<{ productId: string; productName: string | null; quantity: number; unitPrice: string }>;
      };
      const cartsData = cartsRes.ok
        ? (cartsRes.data as { result?: { data?: { orders: CartOrder[]; total: number; totalPages: number } } })?.result?.data
        : null;
      const total = cartsData?.total ?? 0;
      const totalPages = cartsData?.totalPages ?? (total === 0 ? 0 : Math.ceil(total / ORDERS_PER_PAGE));
      const orders: Order[] = (cartsData?.orders ?? []).map((c) => ({
        id: c.id,
        orderNumber: c.orderNumber,
        customerName: c.customerName,
        customerPhoneDisplay: '',
        status: c.status,
        totalAmount: c.totalAmount,
        createdAt: c.createdAt,
        assignedCsId: c.assignedCsId,
        assignedCsName: c.assignedCsName,
        mediaBuyerId: c.mediaBuyerId,
        mediaBuyerName: c.mediaBuyerName,
        primaryProductId: c.orderItems[0]?.productId ?? null,
        primaryProductName: c.orderItems[0]?.productName ?? null,
        itemCount: c.orderItems.length,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
      }));
      return { orders, total, totalPages };
    }

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

      if (!bundleRes.ok) {
        console.error('[marketing.ordersPageBundle] Bundle request failed:', bundleRes.status, JSON.stringify(bundleRes.data).slice(0, 500));
      }
      const data = bundleRes.ok
        ? (bundleRes.data as {
            result?: {
              data?: {
                statusCounts: Record<string, number>;
                metrics: {
                  cpa: number;
                  totalSpend: number;
                  totalOrders: number;
                  deliveredOrders: number;
                  deliveredRevenue: number;
                  confirmedOrders: number;
                  confirmationRate: number;
                  trueRoas: number;
                  deliveryRate: number;
                };
                dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
                mediaBuyersForFilter: Array<{ id: string; name: string }>;
                productsForFilter: Array<{ id: string; name: string }>;
                campaignsForFilter: Array<{ id: string; name: string }>;
                abandonedCartCount: number;
                offlineCount: number;
                duplicateCount: number;
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

      const defaultMetrics = { totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0, totalSpend: 0 };
      const m = data?.metrics ?? defaultMetrics;

      // Always show order status counts in the stat strip — cart breakdown
      // lives on the dedicated Cart Orders page.
      const statusCounts = data?.statusCounts ?? {};

      return {
        statusCounts,
        cpa: m.cpa ?? null,
        totalAdSpend: m.totalSpend ?? null,
        metrics: m,
        dailyCounts: data?.dailyCounts ?? [],
        marketingExportPicklists,
        mediaBuyersForFilter,
        productsForFilter,
        campaignsForFilter,
        abandonedCartCount: data?.abandonedCartCount ?? 0,
        offlineCount: data?.offlineCount ?? 0,
        duplicateCount: data?.duplicateCount ?? 0,
      };
    } catch (err) {
      console.error('[marketing.ordersPageBundle] Secondary bundle failed:', err instanceof Error ? err.message : err);
      return {
        statusCounts: {},
        cpa: null,
        totalAdSpend: null,
        metrics: { totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0, totalSpend: 0 },
        dailyCounts: [],
        marketingExportPicklists: undefined,
        mediaBuyersForFilter: [],
        productsForFilter: [],
        campaignsForFilter: [],
        abandonedCartCount: 0,
        offlineCount: 0,
        duplicateCount: 0,
      };
    }
  })();

  // Personal bundle for the supervisor's "My Performance" stat strip — scoped
  // to their own mediaBuyerId so stats switch instantly on tab toggle.
  const personalSecondaryPromise: Promise<MarketingOrdersSecondaryPayload | null> = personalBundleInputStr
    ? (async () => {
        try {
          const res = await apiRequest<unknown>(
            `/trpc/marketing.ordersPageBundle?input=${personalBundleInputStr}`,
            { method: 'GET', cookie },
          );
          const data = res.ok
            ? (res.data as {
                result?: {
                  data?: {
                    statusCounts: Record<string, number>;
                    metrics: {
                      cpa: number;
                      totalSpend: number;
                      totalOrders: number;
                      deliveredOrders: number;
                      deliveredRevenue: number;
                      confirmedOrders: number;
                      confirmationRate: number;
                      trueRoas: number;
                      deliveryRate: number;
                    };
                    dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
                    mediaBuyersForFilter: Array<{ id: string; name: string }>;
                    productsForFilter: Array<{ id: string; name: string }>;
                    campaignsForFilter: Array<{ id: string; name: string }>;
                    abandonedCartCount: number;
                    offlineCount: number;
                    duplicateCount: number;
                  };
                };
              })?.result?.data
            : null;
          const defaultM = { totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0, totalSpend: 0 };
          const m = data?.metrics ?? defaultM;
          return {
            statusCounts: data?.statusCounts ?? {},
            cpa: m.cpa ?? null,
            totalAdSpend: m.totalSpend ?? null,
            metrics: m,
            dailyCounts: data?.dailyCounts ?? [],
            mediaBuyersForFilter: [],
            productsForFilter: [],
            campaignsForFilter: [],
            abandonedCartCount: data?.abandonedCartCount ?? 0,
            offlineCount: data?.offlineCount ?? 0,
            duplicateCount: data?.duplicateCount ?? 0,
          };
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  // On page 2+ skip the secondary bundle (it doesn't depend on `page`).
  const isPaginationOnly = page > 1;

  const pageData = isPaginationOnly
    ? listPromise.then((listResult) => ({
        listResult,
        secondaryResult: EMPTY_SECONDARY,
        personalSecondaryResult: null as MarketingOrdersSecondaryPayload | null,
      }))
    : Promise.all([listPromise, secondaryPromise, personalSecondaryPromise]).then(
        ([listResult, secondaryResult, personalSecondaryResult]) => ({
          listResult,
          secondaryResult,
          personalSecondaryResult,
        }),
      );

  return defer({ ordersShell, pageData });
}

// Client-side cache for instant revisits. Live socket events
// (`usePageRefreshOnEvent`) call `invalidateCachedLoader` before
// revalidating, so stale-after-branch-switch is avoided.
export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const form = await request.formData();
  const intent = form.get('intent')?.toString();

  if (intent === 'purgeTestOrders') {
    const user = await requirePermission(request, 'marketing.orders');
    const canPurge =
      isAdminLevel(user) ||
      user.role === 'HEAD_OF_MARKETING' ||
      user.isMarketingTeamSupervisorOnActiveBranch === true;
    if (!canPurge) {
      return json({ error: 'Not authorized' }, { status: 403 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.purgeTestOrders', {
      method: 'POST',
      cookie,
      body: {},
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to clear test orders') }, { status: res.status > 599 ? 500 : res.status });
    }
    const data = (res.data as { result?: { data?: { deleted: number; skipped: number } } })?.result?.data;
    return json({ success: true, deleted: data?.deleted ?? 0, skipped: data?.skipped ?? 0 });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingOrdersRoute() {
  const { ordersShell, pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_ORDERS_LIVE_EVENTS]);

  const shellProps = {
    page: ordersShell.page,
    limit: ordersShell.perPage,
    statusFilter: ordersShell.statusFilter,
    searchFilter: ordersShell.searchFilter,
    sortBy: ordersShell.sortBy,
    sortOrder: ordersShell.sortOrder,
    isMediaBuyer: ordersShell.isMediaBuyer,
    isMarketingSupervisor: ordersShell.isMarketingSupervisor,
    showMediaBuyerColumn: ordersShell.showMediaBuyerColumn,
    filters: ordersShell.filters,
    liveEvents: [...MARKETING_ORDERS_LIVE_EVENTS] as string[],
    canExport: ordersShell.canExport,
    viewerUserId: ordersShell.viewerUserId,
    activeMediaBuyerFilter: ordersShell.activeMediaBuyerFilter,
    enableTestOrdersOption: ordersShell.enableTestOrdersOption,
    enableFromCartStatusOption: ordersShell.enableFromCartStatusOption,
    isCartAbandonmentView: ordersShell.isCartAbandonmentView,
  };

  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <MarketingOrdersPage
          {...shellProps}
          secondary={EMPTY_SECONDARY}
          orders={[]}
          total={0}
          totalPages={0}
          deferredLoading
        />
      }
      loaderShell={{ ordersShell }}
      deferredKey="pageData"
    >
      {(data) => (
        <MarketingOrdersPage
          {...shellProps}
          secondary={data.secondaryResult as MarketingOrdersSecondaryPayload}
          personalSecondary={data.personalSecondaryResult ?? undefined}
          orders={(data.listResult as { orders: Order[]; total: number; totalPages: number }).orders}
          total={(data.listResult as { orders: Order[]; total: number; totalPages: number }).total}
          totalPages={(data.listResult as { orders: Order[]; total: number; totalPages: number }).totalPages}
        />
      )}
    </CachedAwait>
  );
}
