import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { DeliveryRemittancesPage } from '~/features/finance/DeliveryRemittancesPage';
import type { DeliveryRemittanceListItem, DeliveryRemittanceDetail } from '~/features/finance/DeliveryRemittancesPage';

export const meta: MetaFunction = () => [
  { title: 'Delivery Cash Remittances — Finance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  // If _detail param is present, this is a client-side fetcher call for modal data only
  const detailOnlyId = url.searchParams.get('_detail');
  if (detailOnlyId) {
    const detailRes = await apiRequest<unknown>(
      '/trpc/logistics.getDeliveryRemittance?input=' +
        encodeURIComponent(JSON.stringify({ deliveryRemittanceId: detailOnlyId })),
      { method: 'GET', cookie },
    );
    const detail = detailRes.ok
      ? (detailRes.data as { result?: { data?: DeliveryRemittanceDetail } })?.result?.data ?? null
      : null;
    return json({ _detailOnly: true, detail });
  }
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

  // SA + ADMIN carry an empty permissions array (bypass at middleware); include them explicitly.
  const hasApprovePermission = isAdminLevel(user) || (user?.permissions?.includes('finance.approve') ?? false);

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
    hasApprovePermission,
    userMap,
    summary,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'finance.approve');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  const deliveryRemittanceId = formData.get('deliveryRemittanceId')?.toString();
  if (!deliveryRemittanceId) {
    return json({ error: 'Missing delivery remittance ID' }, { status: 400 });
  }

  if (intent === 'markReceived') {
    const res = await apiRequest<unknown>('/trpc/logistics.markDeliveryRemittanceReceived', {
      method: 'POST',
      cookie,
      body: { deliveryRemittanceId },
    });

    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to mark received';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'dispute') {
    const disputeReason = formData.get('disputeReason')?.toString();
    if (!disputeReason || disputeReason.length < 10) {
      return json({ error: 'Dispute reason must be at least 10 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.disputeDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { deliveryRemittanceId, disputeReason },
    });

    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to dispute remittance';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminFinanceDeliveryRemittancesRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <DeliveryRemittancesPage
      remittances={data.remittances}
      pagination={data.pagination}
      locations={data.locations}
      filters={data.filters}
      hasApprovePermission={data.hasApprovePermission}
      userMap={data.userMap}
      summary={data.summary}
    />
  );
}
