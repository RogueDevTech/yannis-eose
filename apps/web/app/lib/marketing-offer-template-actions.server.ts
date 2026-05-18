import { json } from '@remix-run/node';
import { apiRequest, redirectIfUnauthorized, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

function parseCurrencyToNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Remix action helper: full tier CRUD payloads posted from {@link OfferTiersPanel}
 * (marketing form routes — not the product catalog).
 */
export async function respondToOfferTemplateIntent(opts: {
  intent: string | undefined;
  formData: FormData;
  cookie: string | undefined;
  /** When set, `formData.productId` must match (form edit route vs campaign SKU). */
  enforceProductId?: string;
  unauthorizedRedirect: string;
}): Promise<Response | null> {
  const { intent, formData, cookie, enforceProductId, unauthorizedRedirect } = opts;

  if (
    intent !== 'createOfferTemplate' &&
    intent !== 'updateOfferTemplate' &&
    intent !== 'archiveAllOfferTemplates'
  ) {
    return null;
  }

  const productId = formData.get('productId')?.toString() ?? '';
  if (!productId) {
    return json({ error: 'Product required' }, { status: 400 });
  }
  if (enforceProductId != null && productId !== enforceProductId) {
    return json({ error: 'Product mismatch' }, { status: 400 });
  }

  if (intent === 'archiveAllOfferTemplates') {
    const res = await apiRequest<{ result?: { data?: { archivedCount?: number } } }>(
      '/trpc/marketing.archiveAllOfferTemplatesForProduct',
      {
        method: 'POST',
        cookie,
        body: { productId },
      },
    );
    redirectIfUnauthorized(res, unauthorizedRedirect);
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive offer tiers') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = res.data as { result?: { data?: { archivedCount?: number } } };
    const archivedCount = payload?.result?.data?.archivedCount;
    return json({
      success: true,
      ...(typeof archivedCount === 'number' ? { archivedCount } : {}),
    });
  }

  let templateImageUrls: string[] = [];
  try {
    const raw = JSON.parse(formData.get('templateImageUrls')?.toString() ?? '[]');
    templateImageUrls = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return json({ error: 'Invalid template images JSON' }, { status: 400 });
  }

  const qty = parseInt(formData.get('templateQty')?.toString() ?? '1', 10);
  if (!Number.isFinite(qty) || qty < 1) {
    return json({ error: 'Tier quantity must be at least 1' }, { status: 400 });
  }

  const priceNum = parseCurrencyToNumber(formData.get('templatePrice')?.toString() ?? '');
  if (priceNum == null) {
    return json({ error: 'Valid tier price is required' }, { status: 400 });
  }

  const name = formData.get('templateName')?.toString()?.trim() ?? '';
  if (!name) {
    return json({ error: 'Tier label is required' }, { status: 400 });
  }

  if (intent === 'createOfferTemplate') {
    const res = await apiRequest<unknown>('/trpc/marketing.createOfferTemplate', {
      method: 'POST',
      cookie,
      body: {
        productId,
        name,
        price: priceNum,
        quantity: qty,
        imageUrls: templateImageUrls,
      },
    });
    redirectIfUnauthorized(res, unauthorizedRedirect);
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create offer tier') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  const templateId = formData.get('templateId')?.toString() ?? '';
  if (!templateId) {
    return json({ error: 'Template id required' }, { status: 400 });
  }

  const statusRaw = formData.get('templateStatus')?.toString();
  const status =
    statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE' || statusRaw === 'ARCHIVED' ? statusRaw : undefined;

  const body: Record<string, unknown> = {
    id: templateId,
    name,
    price: priceNum,
    quantity: qty,
    imageUrls: templateImageUrls,
  };
  if (status) body.status = status;

  const res = await apiRequest<unknown>('/trpc/marketing.updateOfferTemplate', {
    method: 'POST',
    cookie,
    body,
  });
  redirectIfUnauthorized(res, unauthorizedRedirect);
  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to update offer tier') },
      { status: safeStatus(res.status) },
    );
  }
  return json({ success: true });
}
