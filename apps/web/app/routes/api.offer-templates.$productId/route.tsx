import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';

type TemplateRow = {
  id: string;
  name: string;
  quantity: number;
  price: string;
  status: string;
  imageUrls: string[];
};

function mapTemplate(api: Record<string, unknown>): TemplateRow | null {
  const id = api.id != null ? String(api.id) : '';
  if (!id) return null;
  const qtyRaw = api.quantity ?? api.qty;
  const qty = typeof qtyRaw === 'number' ? qtyRaw : Number.parseInt(String(qtyRaw), 10) || 1;
  const imgsRaw = api.imageUrls ?? api.image_urls;
  const imageUrls = Array.isArray(imgsRaw)
    ? imgsRaw.filter((u): u is string => typeof u === 'string')
    : [];
  return {
    id,
    name: String(api.name ?? ''),
    quantity: qty,
    price: String(api.price ?? '0'),
    status: String(api.status ?? 'ACTIVE'),
    imageUrls,
  };
}

/**
 * JSON resource for Marketing form builder — lists offer templates for a product (authenticated).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');

  const productId = params.productId ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    return json({ templates: [] as TemplateRow[] });
  }

  const cookie = getSessionCookie(request);
  if (!cookie) {
    return json({ templates: [] as TemplateRow[] }, { status: 401 });
  }

  const input = encodeURIComponent(
    JSON.stringify({ productId, page: 1, limit: 100 }),
  );
  const res = await apiRequest<unknown>(
    `/trpc/marketing.listOfferTemplates?input=${input}`,
    { method: 'GET', cookie },
  );
  if (!res.ok) {
    return json({ templates: [] as TemplateRow[], error: 'Could not load offer templates' }, { status: 200 });
  }

  const data = res.data as { result?: { data?: { templates?: unknown[] } } };
  const raw = data?.result?.data?.templates ?? [];
  const templates = raw
    .map((r) => mapTemplate(typeof r === 'object' && r != null ? (r as Record<string, unknown>) : {}))
    .filter((x): x is TemplateRow => x != null);

  return json({ templates });
}
