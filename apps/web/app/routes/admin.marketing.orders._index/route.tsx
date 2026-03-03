import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOrdersPage } from '~/features/marketing/MarketingOrdersPage';
import type { Order } from '~/features/orders/types';

export const meta: MetaFunction = () => [
  { title: 'Marketing Orders — Yannis EOSE' },
];

const ORDERS_PER_PAGE = 40;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.orders');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const mediaBuyerIdParam = url.searchParams.get('mediaBuyerId') || undefined;

  const isMediaBuyer = user.role === 'MEDIA_BUYER';
  const mediaBuyerId = isMediaBuyer ? user.id : mediaBuyerIdParam;

  const listInput = {
    page,
    limit: ORDERS_PER_PAGE,
    status: status || undefined,
    search: search || undefined,
    mediaBuyerId,
  };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));
  const countsInputStr = mediaBuyerId
    ? encodeURIComponent(JSON.stringify({ mediaBuyerId }))
    : '%7B%7D';

  const [res, countsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.list?input=${listInputStr}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, { method: 'GET', cookie }),
  ]);

  const trpcData = res.ok
    ? (res.data as { result?: { data?: { orders: Order[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;

  const countsData = countsRes.ok
    ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
    : {};

  const total = trpcData?.pagination?.total ?? 0;
  const totalPages = trpcData?.pagination?.totalPages ?? Math.ceil(total / ORDERS_PER_PAGE);

  return {
    orders: trpcData?.orders ?? [],
    total,
    totalPages,
    page,
    limit: ORDERS_PER_PAGE,
    statusCounts: countsData,
    statusFilter: status,
    searchFilter: search,
    isMediaBuyer,
  };
}

export default function MarketingOrdersRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);
  return <MarketingOrdersPage {...data} />;
}
