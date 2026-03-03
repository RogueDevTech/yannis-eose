import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { OrdersListPage } from '~/features/orders/OrdersListPage';
import type { Order } from '~/features/orders/types';

export const meta: MetaFunction = () => [
  { title: 'CS Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'orders.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const input = encodeURIComponent(JSON.stringify({ page, limit: ORDERS_PER_PAGE, status: status || undefined, search: search || undefined }));

  const [res, countsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${input}`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.statusCounts?input=%7B%7D', { method: 'GET', cookie }),
  ]);

  const trpcData = res.ok
    ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;

  const countsData = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};

  const total = trpcData?.pagination?.total ?? 0;
  const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  return json({
    orders: trpcData?.orders ?? [],
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusCounts: countsData,
    statusFilter: status,
    searchFilter: search,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'orders.bulkTransition');
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'bulkTransition') {
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const newStatus = form.get('newStatus') as string;

    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkTransition',
      {
        method: 'POST',
        cookie,
        body: { orderIds, newStatus },
      },
    );

    if (!res.ok) {
      return json({ success: false, error: 'Bulk transition failed', succeeded: 0, failed: orderIds.length, results: [] });
    }

    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  if (intent === 'bulkAssign') {
    const orderIds = JSON.parse(form.get('orderIds') as string) as string[];
    const csAgentId = form.get('csAgentId') as string;

    const res = await apiRequest<{ result?: { data?: { succeeded: number; failed: number; total: number; results: Array<{ orderId: string; success: boolean; error?: string }> } } }>(
      '/trpc/orders.bulkAssignToCS',
      {
        method: 'POST',
        cookie,
        body: { orderIds, csAgentId },
      },
    );

    if (!res.ok) {
      return json({ success: false, error: 'Bulk assign failed', succeeded: 0, failed: orderIds.length, results: [] });
    }

    const data = res.data?.result?.data;
    return json({
      success: true,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      results: data?.results ?? [],
    });
  }

  return json({ success: false, error: 'Unknown intent' });
}

export default function CSOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/admin') as { user: { role: string } } | undefined;
  const userRole = parentData?.user?.role;
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <OrdersListPage {...data} userRole={userRole} />;
}
