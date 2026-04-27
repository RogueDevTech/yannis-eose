import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { DeliveryRemittancesPage } from '~/features/finance/DeliveryRemittancesPage';
import type { DeliveryRemittanceListItem } from '~/features/finance/DeliveryRemittancesPage';

export const meta: MetaFunction = () => [
  { title: 'Cash Remittances — Finance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const pageParam = parseInt(url.searchParams.get('page') ?? '1', 10);
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const statusFilter = url.searchParams.get('status') ?? undefined;
  const locationFilter = url.searchParams.get('location') ?? undefined;

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
    limit: 20,
  };
  if (statusFilter && ['SENT', 'RECEIVED', 'DISPUTED'].includes(statusFilter)) {
    listInput.status = statusFilter;
  }
  if (locationFilter) {
    listInput.logisticsLocationId = locationFilter;
  }
  if (startDate) listInput.startDate = startDate;
  if (endDate) listInput.endDate = endDate;

  const [listRes, locationsRes, usersRes] = await Promise.all([
    apiRequest<unknown>(
      '/trpc/logistics.listDeliveryRemittances?input=' + encodeURIComponent(JSON.stringify(listInput)),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.listLocations?input=' +
        encodeURIComponent(JSON.stringify({ page: 1, limit: 50, status: 'ACTIVE' })),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  type SummaryData = { totalRemitted: string; pendingAmount: string; receivedAmount: string; disputedAmount: string; totalCount: string; pendingCount: string; receivedCount: string; disputedCount: string };
  const listData = listRes.ok
    ? (listRes.data as { result?: { data?: { records: DeliveryRemittanceListItem[]; pagination: { total: number; totalPages?: number }; summary?: SummaryData } } })?.result?.data
    : null;
  const remittances = listData?.records ?? [];
  const total = listData?.pagination?.total ?? 0;
  const totalPages = listData?.pagination?.totalPages ?? (Math.ceil(total / 20) || 1);
  const summary = listData?.summary ?? {
    totalRemitted: '0', pendingAmount: '0', receivedAmount: '0', disputedAmount: '0',
    totalCount: '0', pendingCount: '0', receivedCount: '0', disputedCount: '0',
  };

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Array<{ id: string; name: string }> } } })?.result?.data
    : null;
  const locations = locationsData?.locations ?? [];

  // Build user name map for sentBy resolution
  const usersData = usersRes.ok
    ? (usersRes.data as { result?: { data?: { users: Array<{ id: string; name: string }> } } })?.result?.data?.users
    : null;
  const userMap: Record<string, string> = {};
  if (usersData) {
    for (const u of usersData) {
      userMap[u.id] = u.name;
    }
  }

  return {
    remittances,
    pagination: { total, totalPages, page },
    locations,
    filters: {
      status: statusFilter ?? '',
      location: locationFilter ?? '',
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
    userMap,
    summary,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  return json({ error: 'Use remittance detail page for actions' }, { status: 400 });
}

export default function AdminFinanceDeliveryRemittancesRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <DeliveryRemittancesPage
      remittances={data.remittances}
      pagination={data.pagination}
      locations={data.locations}
      filters={data.filters}
      userMap={data.userMap}
      summary={data.summary}
    />
  );
}
