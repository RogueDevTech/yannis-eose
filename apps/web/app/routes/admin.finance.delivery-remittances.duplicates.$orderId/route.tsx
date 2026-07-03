import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { DuplicateComparisonPage } from '~/features/finance/DuplicateComparisonPage';

export const meta: MetaFunction = () => [{ title: 'Duplicate Orders — Finance — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.read',
  });
  const cookie = getSessionCookie(request);
  const orderId = params.orderId!;

  const input = encodeURIComponent(JSON.stringify({ orderId }));
  const res = await apiRequest<unknown>(
    `/trpc/logistics.getDuplicateGroup?input=${input}`,
    { method: 'GET', cookie },
  );

  type GroupData = {
    originalOrderId: string;
    products: Array<{ id: string; name: string }>;
    orders: Array<{
      id: string;
      orderNumber: number | null;
      customerName: string;
      totalAmount: string;
      deliveryFee: string | null;
      status: string;
      orderSource: string | null;
      isFollowUp: boolean;
      isOriginal: boolean;
      isDuplicate: string | null;
      createdAt: string;
      confirmedAt: string | null;
      deliveredAt: string | null;
      closerName: string | null;
      mediaBuyerName: string | null;
      locationName: string | null;
      providerName: string | null;
      invoice: {
        id: string;
        referenceNumber: number;
        totalAmount: string;
        status: string;
        createdAt: string;
      } | null;
      remittance: {
        id: string;
        status: string;
        sentAt: string;
        receivedAt: string | null;
      } | null;
    }>;
  };

  const data: GroupData = res.ok
    ? ((res.data as { result?: { data?: GroupData } })?.result?.data ?? { originalOrderId: orderId, products: [], orders: [] })
    : { originalOrderId: orderId, products: [], orders: [] };

  return defer({ data });
}

export default function DuplicateComparisonRoute() {
  const { data } = useLoaderData<typeof loader>();
  return <DuplicateComparisonPage data={data as Parameters<typeof DuplicateComparisonPage>[0]['data']} />;
}
