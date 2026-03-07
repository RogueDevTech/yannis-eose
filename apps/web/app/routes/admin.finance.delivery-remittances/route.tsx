import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { DeliveryRemittancesPage } from '~/features/finance/DeliveryRemittancesPage';
import type { DeliveryRemittanceListItem, DeliveryRemittanceDetail } from '~/features/finance/DeliveryRemittancesPage';

export const meta: MetaFunction = () => [
  { title: 'Delivery remittances — Finance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const detailId = url.searchParams.get('detail') ?? undefined;

  const listRes = await apiRequest<unknown>(
    '/trpc/logistics.listDeliveryRemittances?input=' +
      encodeURIComponent(JSON.stringify({ page: 1, limit: 20 })),
    { method: 'GET', cookie },
  );

  const listData = listRes.ok
    ? (listRes.data as { result?: { data?: { records: DeliveryRemittanceListItem[] } } })?.result?.data
    : null;
  const remittances = listData?.records ?? [];

  let selectedDetail: DeliveryRemittanceDetail | null = null;
  if (detailId) {
    const detailRes = await apiRequest<unknown>(
      '/trpc/logistics.getDeliveryRemittance?input=' +
        encodeURIComponent(JSON.stringify({ deliveryRemittanceId: detailId })),
      { method: 'GET', cookie },
    );
    if (detailRes.ok) {
      const data = (detailRes.data as { result?: { data?: DeliveryRemittanceDetail } })?.result?.data;
      if (data) selectedDetail = data;
    }
  }

  const hasApprovePermission = user?.permissions?.includes('finance.approve') ?? false;

  return {
    remittances,
    selectedDetail,
    hasApprovePermission,
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
      selectedDetail={data.selectedDetail}
      hasApprovePermission={data.hasApprovePermission}
    />
  );
}
