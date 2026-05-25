import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
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
const MARKETING_ORDERS_LIVE_EVENTS = ['order:new', 'order:status_changed', 'cart:updated'] as const;

const getDefaultTodayRange = defaultTodayRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.orders');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  // URL-driven page size — clamped to allowed set; default 50.
  const { perPage: ORDERS_PER_PAGE } = parsePerPage(url.searchParams, { defaultPerPage: 50 });
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
  if (!periodAllTime && !startDate && !endDate) {
    const def = getDefaultTodayRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  // Marketing team supervisors on the active branch get HoM-like UX here:
  // they see the MB column, the buyer filter, and don't get auto-pinned to
  // their own orders. Backend `orders.list` narrows to their team via
  // `applySupervisorScope` so passing no mediaBuyerId returns team-scoped data
  // (NOT branch-wide). See orders.router.ts narrowOrdersAggregateFiltersForViewer.
  const isMarketingSupervisor =
    user.role === 'MEDIA_BUYER' && user.isMarketingTeamSupervisorOnActiveBranch === true;
  const isMediaBuyer = user.role === 'MEDIA_BUYER' && !isMarketingSupervisor;
  const mediaBuyerId = isMediaBuyer ? user.id : mediaBuyerIdParam;
  const showMediaBuyerColumn =
    user.role === 'HEAD_OF_MARKETING' ||
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    isMarketingSupervisor;
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
    // Marketing orders scope by the marketing branch (`orders.branch_id`), not
    // the CS servicing branch (`orders.servicing_branch_id`) — see migration 0150.
    branchScope: 'marketing' as const,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(testOrders && { testOrders: true }),
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
    isMarketingSupervisor,
    showMediaBuyerColumn,
    canExport,
    page,
    perPage: ORDERS_PER_PAGE,
    statusFilter: status,
    searchFilter: search,
    viewerUserId: user.id,
    activeMediaBuyerFilter: mediaBuyerId ?? null,
    // Everyone who can open this page (gated on `marketing.orders`) may switch
    // to the cart-abandonment view; scope is enforced server-side per role.
    enableFromCartStatusOption: true,
    enableTestOrdersOption:
      isAdminLevel(user) ||
      user.role === 'HEAD_OF_MARKETING' ||
      user.isMarketingTeamSupervisorOnActiveBranch === true,
    isCartAbandonmentView: fromCart,
  };

  // Defer the orders list — page chrome renders immediately, table swaps from
  // skeleton rows to real ones when this promise resolves.
  //
  // Cart-abandonment view: when `?fromCart=1` is active the table is fed the
  // un-recovered abandoned-cart backlog instead of orders. Each cart is mapped
  // into an `Order`-shaped row with the synthetic status `'CART'` so the shared
  // table renders it; `cartId` back-links the "View cart" quick-detail modal.
  const listPromise = (async () => {
    if (fromCart) {
      const cartsInput = encodeURIComponent(
        JSON.stringify({
          page,
          limit: ORDERS_PER_PAGE,
          ...(mediaBuyerId ? { mediaBuyerId } : {}),
          ...(search ? { search } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        }),
      );
      const cartsRes = await apiRequest<unknown>(`/trpc/cart.listAbandoned?input=${cartsInput}`, {
        method: 'GET',
        cookie,
      });
      const cartsData = cartsRes.ok
        ? (
            cartsRes.data as {
              result?: {
                data?: {
                  items: Array<{
                    id: string;
                    customerName: string;
                    customerPhoneDisplay: string;
                    productId: string | null;
                    productName: string | null;
                    campaignId: string | null;
                    campaignName: string | null;
                    mediaBuyerId: string | null;
                    mediaBuyerName: string | null;
                    updatedAt: string;
                    quantity: number | null;
                  }>;
                  total: number;
                };
              };
            }
          )?.result?.data
        : null;
      const total = cartsData?.total ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / ORDERS_PER_PAGE);
      const orders: Order[] = (cartsData?.items ?? []).map((c) => ({
        id: c.id,
        customerName: c.customerName,
        customerPhoneDisplay: '',
        status: 'CART',
        totalAmount: null,
        createdAt: c.updatedAt,
        assignedCsId: null,
        primaryProductId: c.productId ?? null,
        primaryProductName: c.productName ?? null,
        itemCount: c.quantity ?? 0,
        campaignId: c.campaignId ?? null,
        campaignName: c.campaignName ?? null,
        mediaBuyerId: c.mediaBuyerId ?? null,
        mediaBuyerName: c.mediaBuyerName ?? null,
        // Back-link drives the "View cart" quick-detail modal.
        cartId: c.id,
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
                abandonedCartCount: number;
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
        abandonedCartCount: data?.abandonedCartCount ?? 0,
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
        abandonedCartCount: 0,
      };
    }
  })();

  return defer({
    ordersShell,
    listPromise,
    secondaryPromise,
  });
}

// NOTE: no `clientLoader` / full-loader cache here. This is a live socket page
// (live order events + branch switcher) — client-caching the loader payload by
// URL served stale data after a branch switch ("All branches" showed another
// branch's numbers). Per CLAUDE.md, live socket pages are not client-cached.

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
  const { ordersShell, listPromise, secondaryPromise } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_ORDERS_LIVE_EVENTS]);
  const sharedProps = {
    page: ordersShell.page,
    limit: ordersShell.perPage,
    secondary: secondaryPromise,
    statusFilter: ordersShell.statusFilter,
    searchFilter: ordersShell.searchFilter,
    isMediaBuyer: ordersShell.isMediaBuyer,
    isMarketingSupervisor: ordersShell.isMarketingSupervisor,
    showMediaBuyerColumn: ordersShell.showMediaBuyerColumn,
    filters: ordersShell.filters,
    liveEvents: [...MARKETING_ORDERS_LIVE_EVENTS],
    canExport: ordersShell.canExport,
    viewerUserId: ordersShell.viewerUserId,
    activeMediaBuyerFilter: ordersShell.activeMediaBuyerFilter,
    enableFromCartStatusOption: ordersShell.enableFromCartStatusOption,
    enableTestOrdersOption: ordersShell.enableTestOrdersOption,
    isCartAbandonmentView: ordersShell.isCartAbandonmentView,
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
