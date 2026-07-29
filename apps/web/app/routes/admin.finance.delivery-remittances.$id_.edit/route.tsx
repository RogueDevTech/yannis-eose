import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { DeliveryRemittanceDetail } from '~/features/finance/DeliveryRemittancesPage';
import { CashRemittanceEditPage } from '~/features/finance/CashRemittanceEditPage';

export const meta: MetaFunction = () => [
  { title: 'Edit Cash Remittance — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['finance.approve', 'finance.cashRemittance.create']);
  const cookie = getSessionCookie(request);
  const remittanceId = params['id'];
  if (!remittanceId) throw redirect('/admin/finance/delivery-remittances');

  const detailRes = await apiRequest<unknown>(
    `/trpc/logistics.getDeliveryRemittance?input=${encodeURIComponent(
      JSON.stringify({ deliveryRemittanceId: remittanceId }),
    )}`,
    { method: 'GET', cookie },
  );
  const detail = detailRes.ok
    ? ((detailRes.data as { result?: { data?: DeliveryRemittanceDetail } })?.result?.data ?? null)
    : null;
  if (!detail) throw new Response('Remittance not found', { status: 404 });

  return { detail };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, ['finance.approve', 'finance.cashRemittance.create']);
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateRemittance') {
    const id = formData.get('id')?.toString();
    if (!id) return json({ error: 'Missing remittance ID' }, { status: 400 });

    const notes = formData.get('notes')?.toString()?.trim() || null;
    const commitmentFee = formData.get('commitmentFee')?.toString() || undefined;
    const posFee = formData.get('posFee')?.toString() || undefined;
    const failedDeliveryCost = formData.get('failedDeliveryCost')?.toString() || undefined;
    const discount = formData.get('discount')?.toString() || undefined;
    const waybillCost = formData.get('waybillCost')?.toString() || undefined;

    let deliveryFees: Record<string, string> | undefined;
    const deliveryFeesRaw = formData.get('deliveryFees')?.toString();
    if (deliveryFeesRaw) {
      try {
        deliveryFees = JSON.parse(deliveryFeesRaw);
      } catch { /* ignore invalid JSON */ }
    }

    const body: Record<string, unknown> = { id, notes };
    if (commitmentFee !== undefined) body.commitmentFee = commitmentFee;
    if (posFee !== undefined) body.posFee = posFee;
    if (failedDeliveryCost !== undefined) body.failedDeliveryCost = failedDeliveryCost;
    if (discount !== undefined) body.discount = discount;
    if (waybillCost !== undefined) body.waybillCost = waybillCost;
    if (deliveryFees !== undefined) body.deliveryFees = deliveryFees;

    const res = await apiRequest<unknown>('/trpc/logistics.updateDeliveryRemittance', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update remittance') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function EditCashRemittanceRoute() {
  const { detail } = useLoaderData<typeof loader>();
  return <CashRemittanceEditPage detail={detail} />;
}
