import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useNavigate } from '@remix-run/react';
import { getCurrentUser, apiRequest, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CashRemittanceCreatePage } from '~/features/finance/CashRemittanceCreatePage';
import type { EligibleOrder } from '~/features/finance/CashRemittanceCreateModal';

export const meta: MetaFunction = () => [
  { title: 'Create Cash Remittance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const orderIdsParam = url.searchParams.get('orders') ?? '';
  const orderIds = orderIdsParam.split(',').filter(Boolean);

  if (orderIds.length === 0) {
    throw redirect('/admin/finance/delivery-remittances');
  }

  // Fetch exactly the selected eligible orders by ID
  const eligibleRes = await apiRequest<unknown>(
    '/trpc/logistics.listDeliveryRemittanceEligibleOrders?input=' +
      encodeURIComponent(JSON.stringify({ orderIds, page: 1, limit: orderIds.length })),
    { method: 'GET', cookie },
  );

  let selectedOrders: EligibleOrder[] = [];
  if (eligibleRes.ok) {
    const data = (eligibleRes.data as { result?: { data?: { orders: EligibleOrder[] } } })?.result?.data;
    selectedOrders = data?.orders ?? [];
  }

  return { selectedOrders, userId: user.id, userRole: user.role };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createRemittance') {
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
    const skipDuplicateWarning = formData.get('skipDuplicateWarning')?.toString() === 'true';

    const res = await apiRequest<unknown>('/trpc/logistics.createDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { orderIds, receiptUrls, notes, markReceivedNow, deliveryFees, commitmentFee, posFee, failedDeliveryCost, skipDuplicateWarning },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create remittance') },
        { status: safeStatus(res.status) },
      );
    }

    const resData = (res.data as { result?: { data?: { duplicateWarnings?: unknown[]; remittance?: unknown } } })?.result?.data;
    if (resData?.duplicateWarnings && Array.isArray(resData.duplicateWarnings) && resData.duplicateWarnings.length > 0) {
      return json({ duplicateWarnings: resData.duplicateWarnings });
    }

    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CreateCashRemittanceRoute() {
  const { selectedOrders } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <CashRemittanceCreatePage
      selectedOrders={selectedOrders}
      onBack={() => navigate('/admin/finance/delivery-remittances')}
    />
  );
}
