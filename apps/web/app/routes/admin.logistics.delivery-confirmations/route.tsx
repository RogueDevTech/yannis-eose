import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus, defaultThisMonthRange } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { DeliveryConfirmationsPage } from '~/features/logistics/DeliveryConfirmationsPage';
import type { AllocatedDeliveryOrder, DeliveryConfirmationRequest } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Delivery confirmations — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, ['logistics.read', 'orders.read']);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const statusFilter = statusParam === null ? 'PENDING' : statusParam;
  const statusApi = statusParam === null ? 'PENDING' : (statusParam === '' ? undefined : statusParam);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = 20;

  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultThisMonthRange();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const countsInput: { startDate?: string; endDate?: string } = {};
  if (startDate) countsInput.startDate = startDate;
  if (endDate) countsInput.endDate = endDate;

  const [res, countsRes, allocatedRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/logistics.listDeliveryConfirmationRequests?input=${encodeURIComponent(JSON.stringify({
        status: statusApi,
        page,
        limit,
      }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/orders.statusCounts?input=${encodeURIComponent(JSON.stringify(countsInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({
        page: 1,
        limit: 200,
        status: 'ALLOCATED',
      }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  if (!res.ok) {
    return json(
      { requests: [], total: 0, page: 1, limit, statusFilter, orderCounts: {} as Record<string, number> },
      { status: 200 },
    );
  }

  const data = res.data as { result?: { data?: { requests: DeliveryConfirmationRequest[]; pagination: { total: number } } } };
  const result = data?.result?.data;
  const requests = result?.requests ?? [];
  const total = result?.pagination?.total ?? 0;
  const allocatedOrders: AllocatedDeliveryOrder[] = allocatedRes.ok
    ? (((allocatedRes.data as {
        result?: {
          data?: {
            orders?: Array<{ id: string; status: string; customerName: string; deliveryAddress?: string | null }>;
          };
        };
      })?.result?.data?.orders ?? []).map((order) => ({
        id: order.id,
        status: order.status,
        customerName: order.customerName,
        deliveryAddress: order.deliveryAddress ?? null,
      })))
    : [];

  const orderCounts = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};

  return json({
    requests,
    total,
    page,
    limit,
    statusFilter,
    orderCounts,
    allocatedOrders,
    canAdjustOrder: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS'].includes(user.role),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, ['logistics.read', 'orders.read']);
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const requestId = formData.get('requestId')?.toString();
  const orderId = formData.get('orderId')?.toString();
  const reason = formData.get('reason')?.toString();

  if (intent === 'markDelivered') {
    if (!orderId) {
      return json({ error: 'Order ID required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: { orderId, newStatus: 'DELIVERED', metadata: {} },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to mark delivered') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (!requestId) {
    return json({ error: 'Request ID required' }, { status: 400 });
  }

  if (intent === 'approve') {
    const res = await apiRequest<unknown>('/trpc/logistics.approveDeliveryConfirmation', {
      method: 'POST',
      cookie,
      body: { requestId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to approve') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'reject') {
    const res = await apiRequest<unknown>('/trpc/logistics.rejectDeliveryConfirmation', {
      method: 'POST',
      cookie,
      body: { requestId, reason: reason || undefined },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reject') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Invalid intent' }, { status: 400 });
}

export default function DeliveryConfirmationsRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <DeliveryConfirmationsPage
      requests={data.requests}
      total={data.total}
      page={data.page}
      limit={data.limit}
      statusFilter={data.statusFilter}
      orderCounts={data.orderCounts ?? {}}
      allocatedOrders={data.allocatedOrders ?? []}
      canAdjustOrder={data.canAdjustOrder}
    />
  );
}
