import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import type { DeliveryRemittanceDetail } from '~/features/finance/DeliveryRemittancesPage';
import { DeliveryRemittanceDetailPage } from '~/features/finance/DeliveryRemittanceDetailPage';

export const meta: MetaFunction = () => [
  { title: 'Cash Remittance Detail — Finance — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const remittanceId = params['id'];

  if (!remittanceId) {
    throw new Response('Remittance ID required', { status: 400 });
  }

  const [detailRes, usersRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/logistics.getDeliveryRemittance?input=${encodeURIComponent(
        JSON.stringify({ deliveryRemittanceId: remittanceId }),
      )}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  if (!detailRes.ok) {
    throw new Response('Remittance not found', { status: safeStatus(detailRes.status) });
  }

  const detail =
    (detailRes.data as { result?: { data?: DeliveryRemittanceDetail } })?.result?.data ?? null;
  if (!detail) {
    throw new Response('Remittance not found', { status: 404 });
  }

  const usersData = usersRes.ok
    ? (
        usersRes.data as { result?: { data?: { users: Array<{ id: string; name: string }> } } }
      )?.result?.data?.users
    : null;
  const userMap: Record<string, string> = {};
  if (usersData) {
    for (const u of usersData) userMap[u.id] = u.name;
  }

  const hasApprovePermission =
    isAdminLevel(user) || (user?.permissions?.includes('finance.approve') ?? false);

  return { detail, hasApprovePermission, userMap };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'finance.approve');
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

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
      const err =
        (res.data as { error?: { message?: string } })?.error?.message ??
        'Failed to mark received';
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
      const err =
        (res.data as { error?: { message?: string } })?.error?.message ??
        'Failed to dispute remittance';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminFinanceDeliveryRemittanceDetailRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <DeliveryRemittanceDetailPage
      detail={data.detail}
      hasApprovePermission={data.hasApprovePermission}
      userMap={data.userMap}
    />
  );
}
