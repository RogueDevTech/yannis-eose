import { json, defer } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultThisMonthRange, safeStatus } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { USERS_LIST_MAX_LIMIT } from '~/lib/trpc-list-limits';
import { extractApiErrorMessage } from '~/lib/api-error';
import { DeliveryRemittancesPage } from '~/features/finance/DeliveryRemittancesPage';
import { DeliveryRemittancesLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
import type { DeliveryRemittanceListItem } from '~/features/finance/DeliveryRemittancesPage';
import type { EligibleOrder } from '~/features/finance/CashRemittanceCreateModal';

const REMITTANCES_PAGE_SIZE = 20;
const ELIGIBLE_PAGE_SIZE = 20;

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
  const statusFilter = url.searchParams.get('status') ?? undefined;
  const locationFilter = url.searchParams.get('location') ?? undefined;
  const sentByFilter = url.searchParams.get('sentBy') ?? undefined;

  // Date filtering — default to this month
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const listInput: Record<string, unknown> = {
    page,
    limit: REMITTANCES_PAGE_SIZE,
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

  const eligiblePageParam = parseInt(url.searchParams.get('eligiblePage') ?? '1', 10);
  const eligiblePage =
    isNaN(eligiblePageParam) || eligiblePageParam < 1 ? 1 : eligiblePageParam;
  const eligibleQ = url.searchParams.get('q')?.trim() ?? undefined;

  const eligibleListBase: Record<string, unknown> = {
    page: eligiblePage,
    limit: ELIGIBLE_PAGE_SIZE,
  };
  if (locationFilter) eligibleListBase.logisticsLocationId = locationFilter;
  if (eligibleQ) eligibleListBase.search = eligibleQ;
  if (startDate && !periodAllTime) eligibleListBase.startDate = startDate;
  if (endDate && !periodAllTime) eligibleListBase.endDate = endDate;

  const eligibleListInput = JSON.stringify(eligibleListBase);

  const remittancesShell = {
    filters: {
      status: statusFilter ?? '',
      location: locationFilter ?? '',
      sentBy: sentByFilter ?? '',
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
      eligibleQ: eligibleQ ?? '',
    },
    canCreateRemittance,
    canMarkReceived,
  };

  const pageData = (async () => {
  const [listRes, locationsRes, usersRes, eligibleListRes] = await Promise.all([
    apiRequest<unknown>(
      '/trpc/logistics.listDeliveryRemittances?input=' + encodeURIComponent(JSON.stringify(listInput)),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.locationOptions?input=' +
        encodeURIComponent(JSON.stringify({ status: 'ACTIVE' })),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: USERS_LIST_MAX_LIMIT }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.listDeliveryRemittanceEligibleOrders?input=' +
        encodeURIComponent(eligibleListInput),
      { method: 'GET', cookie },
    ),
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
  const listData = listRes.ok
    ? (listRes.data as { result?: { data?: { records: DeliveryRemittanceListItem[]; pagination: { total: number; totalPages?: number }; summary?: SummaryData } } })?.result?.data
    : null;
  const remittances = listData?.records ?? [];
  const total = listData?.pagination?.total ?? 0;
  const totalPages =
    listData?.pagination?.totalPages ?? (Math.ceil(total / REMITTANCES_PAGE_SIZE) || 1);
  const summary = listData?.summary ?? {
    awaitingAmount: '0',
    awaitingCount: '0',
    totalRemitted: '0', pendingAmount: '0', receivedAmount: '0', disputedAmount: '0',
    totalCount: '0', pendingCount: '0', receivedCount: '0', disputedCount: '0',
  };

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: Array<{ id: string; name: string; providerName?: string | null }> } })?.result?.data
    : null;
  const locations = (locationsData ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
  }));

  // Build user name map for sentBy resolution + accountant filter.
  type UserRow = { id: string; name: string; role: string };
  const usersData = usersRes.ok
    ? (usersRes.data as { result?: { data?: { users: UserRow[] } } })?.result?.data?.users
    : null;
  const userMap: Record<string, string> = {};
  const sentByOptions: Array<{ id: string; name: string }> = [];
  if (usersData) {
    for (const u of usersData) {
      userMap[u.id] = u.name;
      // Sent-by filter only lists accountants — primary FINANCE_OFFICER and
      // admin-class. Non-finance users never appear because they cannot
      // create remittances.
      const isFinance =
        u.role === 'FINANCE_OFFICER' ||
        u.role === 'SUPER_ADMIN' ||
        u.role === 'ADMIN';
      if (isFinance) {
        sentByOptions.push({ id: u.id, name: u.name });
      }
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
    Math.ceil(eligibleTotal / ELIGIBLE_PAGE_SIZE) || 1;

  return {
    remittances,
    pagination: { total, totalPages, page, pageSize: REMITTANCES_PAGE_SIZE },
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
      pageSize: ELIGIBLE_PAGE_SIZE,
    },
    eligibleTotal,
    summary,
    canCreateRemittance,
    canMarkReceived,
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
    if (!Array.isArray(receiptUrls) || receiptUrls.length === 0) {
      return json({ error: 'Upload at least one payment receipt' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.createDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { orderIds, receiptUrls, notes, markReceivedNow },
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
          />
        )}
    </CachedAwait>
  );
}
