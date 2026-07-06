import { json, defer } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, parsePerPage, requirePermissionOrRoles, defaultThisMonthRange, safeStatus } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { USERS_LIST_MAX_LIMIT } from '~/lib/trpc-list-limits';
import { extractApiErrorMessage } from '~/lib/api-error';
import { DeliveryRemittancesPage } from '~/features/finance/DeliveryRemittancesPage';
import { DeliveryRemittancesLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
import type { DeliveryRemittanceListItem } from '~/features/finance/DeliveryRemittancesPage';
import type { EligibleOrder } from '~/features/finance/CashRemittanceCreateModal';

const DEFAULT_ELIGIBLE_PAGE_SIZE = 500;

export const meta: MetaFunction = () => [
  { title: 'Cash Remittances — Finance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Phase 18 — accountant-led flow. Allow Finance roles + admins; rejects
  // TPL_MANAGER specifically (their legacy view stays in /tpl/* if/when 3PL
  // onboards). HR / CS / Marketing don't need access; using `finance.read` as
  // the catch-all permission for granted users.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.read',
  });
  // Phase 21 — capability flags for the page actions. Same gates as the API
  // (`logistics.service.ts` for `createDeliveryRemittance` / `markDeliveryRemittanceReceived`).
  const userPerms = ((user as { permissions?: string[] }).permissions ?? []).map(
    (p) => canonicalPermissionCode(p),
  );
  const isFinanceLike =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'FINANCE_OFFICER';
  const canCreateRemittance =
    isFinanceLike || userPerms.includes(canonicalPermissionCode('finance.cashRemittance.create'));
  const canMarkReceived =
    isFinanceLike || userPerms.includes(canonicalPermissionCode('finance.cashRemittance.markReceived'));
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const pageParam = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const { perPage: remittancesPageSize, pageSizeOptions } = parsePerPage(url.searchParams, { defaultPerPage: 500 });
  const statusFilter = url.searchParams.get('status') ?? undefined;
  const locationFilter = url.searchParams.get('location') ?? undefined;
  const sentByFilter = url.searchParams.get('sentBy') ?? undefined;

  // Date filtering — default to this month
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  } else if (!startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const listInput: Record<string, unknown> = {
    page,
    limit: remittancesPageSize,
  };
  if (statusFilter && ['SENT', 'RECEIVED', 'DISPUTED'].includes(statusFilter)) {
    listInput.status = statusFilter;
  }
  if (locationFilter) {
    listInput.logisticsLocationId = locationFilter;
  }
  if (sentByFilter) {
    listInput.sentBy = sentByFilter;
  }
  if (startDate) listInput.startDate = startDate;
  if (endDate) listInput.endDate = endDate;
  const remittanceSearch = url.searchParams.get('rq')?.trim() ?? undefined;
  if (remittanceSearch) listInput.search = remittanceSearch;

  const eligiblePageParam = parseInt(url.searchParams.get('eligiblePage') ?? '1', 10);
  const eligiblePage =
    isNaN(eligiblePageParam) || eligiblePageParam < 1 ? 1 : eligiblePageParam;
  const { perPage: eligiblePageSize } = parsePerPage(url.searchParams, { defaultPerPage: DEFAULT_ELIGIBLE_PAGE_SIZE, param: 'eligiblePerPage' });
  const eligibleQ = url.searchParams.get('q')?.trim() ?? undefined;

  const eligibleListBase: Record<string, unknown> = {
    page: eligiblePage,
    limit: eligiblePageSize,
  };
  if (locationFilter) eligibleListBase.logisticsLocationId = locationFilter;
  if (eligibleQ) eligibleListBase.search = eligibleQ;
  if (startDate && !periodAllTime) eligibleListBase.startDate = startDate;
  if (endDate && !periodAllTime) eligibleListBase.endDate = endDate;

  const eligibleListInput = JSON.stringify(eligibleListBase);

  // View mode: 'batches' (default) or 'orders' (flat list)
  const viewMode = url.searchParams.get('view') === 'orders' ? 'orders' : 'batches';

  const remittancesShell = {
    filters: {
      status: statusFilter ?? '',
      location: locationFilter ?? '',
      sentBy: sentByFilter ?? '',
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
      eligibleQ: eligibleQ ?? '',
      remittanceSearch: remittanceSearch ?? '',
    },
    canCreateRemittance,
    canMarkReceived,
  };

  const pageData = (async () => {
  // Single bundled call replaces 4 parallel HTTP round-trips. Eligible orders
  // are deferred — loaded on demand when the Create modal opens.
  const bundleInput = encodeURIComponent(JSON.stringify(listInput));

  // Orders view: flat list of individual orders across remittance batches
  type RemittanceOrderRow = {
    id: string; customerName: string; orderNumber: string | null;
    totalAmount: string; deliveryFee: string | null;
    deliveredAt: string | null; status: string;
    remittanceId: string; remittanceStatus: string;
    sentAt: string; locationName: string | null; providerName: string | null;
    isDuplicate: string | null; duplicateOfId: string | null;
  };
  const ordersViewInput = encodeURIComponent(JSON.stringify(listInput));
  const ordersViewPromise = viewMode === 'orders'
    ? apiRequest<unknown>(
        `/trpc/logistics.listDeliveryRemittanceOrders?input=${ordersViewInput}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve(null);

  const [bundleRes, eligibleListRes, ordersViewRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/logistics.deliveryRemittancesPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.listDeliveryRemittanceEligibleOrders?input=' +
        encodeURIComponent(eligibleListInput),
      { method: 'GET', cookie },
    ),
    ordersViewPromise,
  ]);

  type SummaryData = {
    awaitingAmount: string;
    awaitingCount: string;
    totalRemitted: string;
    pendingAmount: string;
    receivedAmount: string;
    disputedAmount: string;
    totalCount: string;
    pendingCount: string;
    receivedCount: string;
    disputedCount: string;
  };

  type BundleData = {
    remittances: { records: DeliveryRemittanceListItem[]; pagination: { total: number; totalPages?: number }; summary?: SummaryData };
    locations: Array<{ id: string; name: string; providerName?: string | null }>;
    users: Array<{ id: string; name: string; role: string }>;
  };
  const bundle = bundleRes.ok
    ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
    : null;

  const listData = bundle?.remittances ?? null;
  const remittances = listData?.records ?? [];
  const total = listData?.pagination?.total ?? 0;
  const totalPages =
    listData?.pagination?.totalPages ?? (Math.ceil(total / remittancesPageSize) || 1);
  const summary = listData?.summary ?? {
    awaitingAmount: '0',
    awaitingCount: '0',
    totalRemitted: '0', pendingAmount: '0', receivedAmount: '0', disputedAmount: '0',
    totalCount: '0', pendingCount: '0', receivedCount: '0', disputedCount: '0',
  };

  const locations = (bundle?.locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
  }));

  // Build user name map for sentBy resolution + accountant filter.
  type UserRow = { id: string; name: string; role: string };
  const usersData: UserRow[] = bundle?.users ?? [];
  const userMap: Record<string, string> = {};
  const sentByOptions: Array<{ id: string; name: string }> = [];
  for (const u of usersData) {
    userMap[u.id] = u.name;
    const isFinance =
      u.role === 'FINANCE_OFFICER' ||
      u.role === 'SUPER_ADMIN' ||
      u.role === 'ADMIN';
    if (isFinance) {
      sentByOptions.push({ id: u.id, name: u.name });
    }
  }
  sentByOptions.sort((a, b) => a.name.localeCompare(b.name));

  const eligibleListData = eligibleListRes.ok
    ? (eligibleListRes.data as { result?: { data?: { orders: EligibleOrder[]; total: number } } })?.result
        ?.data
    : null;
  const eligibleOrders = eligibleListData?.orders ?? [];
  const eligibleTotal = eligibleListData?.total ?? 0;
  const eligibleTotalPages =
    Math.ceil(eligibleTotal / eligiblePageSize) || 1;

  // Parse orders view data
  const ordersViewData = ordersViewRes && 'ok' in ordersViewRes && ordersViewRes.ok
    ? ((ordersViewRes.data as { result?: { data?: { orders: RemittanceOrderRow[]; pagination: { total: number; totalPages: number } } } })?.result?.data ?? null)
    : null;

  return {
    remittances,
    pagination: { total, totalPages, page, pageSize: remittancesPageSize, pageSizeOptions },
    locations,
    filters: {
      status: statusFilter ?? '',
      location: locationFilter ?? '',
      sentBy: sentByFilter ?? '',
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
      eligibleQ: eligibleQ ?? '',
    },
    userMap,
    sentByOptions,
    eligibleOrders,
    eligiblePagination: {
      total: eligibleTotal,
      totalPages: eligibleTotalPages,
      page: eligiblePage,
      pageSize: eligiblePageSize,
    },
    eligibleTotal,
    summary,
    canCreateRemittance,
    canMarkReceived,
    viewMode,
    remittanceOrders: ordersViewData?.orders ?? [],
    remittanceOrdersPagination: ordersViewData?.pagination ?? { total: 0, totalPages: 1 },
  };
  })();

  return defer({ remittancesShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'generateInvoice') {
    const orderId = formData.get('orderId')?.toString();
    if (!orderId) return json({ error: 'Order ID is required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/finance.ensureInvoiceByOrder', {
      method: 'POST',
      cookie,
      body: { orderId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to generate invoice') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'createRemittance') {
    // Order IDs + receipt URLs arrive as JSON strings so we don't have to
    // coordinate `orderIds[0]` / `receiptUrls[0]` field-name shapes across
    // the boundary.
    const orderIdsRaw = formData.get('orderIds')?.toString() ?? '';
    const receiptUrlsRaw = formData.get('receiptUrls')?.toString() ?? '';
    const notes = formData.get('notes')?.toString().trim() || undefined;
    const markReceivedNow = formData.get('markReceivedNow')?.toString() === 'true';

    let orderIds: unknown;
    let receiptUrls: unknown;
    try {
      orderIds = JSON.parse(orderIdsRaw);
      receiptUrls = JSON.parse(receiptUrlsRaw);
    } catch {
      return json({ error: 'Invalid order or receipt payload' }, { status: 400 });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return json({ error: 'Select at least one delivered order' }, { status: 400 });
    }
    if (!Array.isArray(receiptUrls)) {
      receiptUrls = [];
    }

    let deliveryFees: Record<string, string> | undefined;
    const deliveryFeesRaw = formData.get('deliveryFees')?.toString();
    if (deliveryFeesRaw) {
      try {
        deliveryFees = JSON.parse(deliveryFeesRaw);
      } catch { /* ignore invalid JSON */ }
    }

    const commitmentFee = formData.get('commitmentFee')?.toString() || undefined;
    const posFee = formData.get('posFee')?.toString() || undefined;
    const failedDeliveryCost = formData.get('failedDeliveryCost')?.toString() || undefined;

    const res = await apiRequest<unknown>('/trpc/logistics.createDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { orderIds, receiptUrls, notes, markReceivedNow, deliveryFees, commitmentFee, posFee, failedDeliveryCost },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create remittance') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminFinanceDeliveryRemittancesRoute() {
  const { remittancesShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <DeliveryRemittancesLoadingShell
          filters={remittancesShell.filters}
          canCreateRemittance={remittancesShell.canCreateRemittance}
        />
      }
      loaderShell={{ remittancesShell }}
      deferredKey="pageData"
    >
      {(data) => (
          <DeliveryRemittancesPage
            remittances={data.remittances}
            pagination={data.pagination}
            locations={data.locations}
            filters={data.filters}
            userMap={data.userMap}
            sentByOptions={data.sentByOptions}
            eligibleOrders={data.eligibleOrders}
            eligiblePagination={data.eligiblePagination}
            eligibleTotal={data.eligibleTotal}
            summary={data.summary}
            canCreateRemittance={data.canCreateRemittance}
            canMarkReceived={data.canMarkReceived}
            viewMode={data.viewMode as 'batches' | 'orders'}
            remittanceOrders={data.remittanceOrders}
            remittanceOrdersPagination={data.remittanceOrdersPagination}
          />
        )}
    </CachedAwait>
  );
}
