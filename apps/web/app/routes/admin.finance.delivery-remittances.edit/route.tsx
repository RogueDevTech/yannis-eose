import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

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

    let receiptUrls: string[] | undefined;
    const receiptUrlsRaw = formData.get('receiptUrls')?.toString();
    if (receiptUrlsRaw) {
      try {
        receiptUrls = JSON.parse(receiptUrlsRaw);
      } catch { /* ignore invalid JSON */ }
    }

    let deliveryFees: Record<string, string> | undefined;
    const deliveryFeesRaw = formData.get('deliveryFees')?.toString();
    if (deliveryFeesRaw) {
      try {
        deliveryFees = JSON.parse(deliveryFeesRaw);
      } catch { /* ignore invalid JSON */ }
    }

    const body: Record<string, unknown> = { id };
    if (receiptUrls !== undefined) body.receiptUrls = receiptUrls;
    if (notes !== undefined) body.notes = notes;
    if (commitmentFee !== undefined) body.commitmentFee = commitmentFee;
    if (posFee !== undefined) body.posFee = posFee;
    if (failedDeliveryCost !== undefined) body.failedDeliveryCost = failedDeliveryCost;
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
