import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
} from '~/lib/api.server';
import { describeApiFetchFailure } from '~/lib/loader-api-fetch';
import type { OfferGroupRow } from '~/features/campaigns/types';
import type { Product } from '~/features/products/types';

type OffersSummaryPayload = {
  offersProducts: Product[];
  productsLoadError: string | null;
  offerGroups: OfferGroupRow[];
  offerGroupsLoadError: string | null;
};

function parseOfferGroups(payload: unknown): OfferGroupRow[] {
  const data = payload as { result?: { data?: { groups?: unknown[] } } } | null;
  const raw = data?.result?.data?.groups ?? [];
  const out: OfferGroupRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = r.id != null ? String(r.id) : '';
    const name = r.name != null ? String(r.name) : '';
    if (!id || !name) continue;
    const status = r.status != null ? String(r.status) : 'ACTIVE';
    const createdBy = r.createdBy != null ? String(r.createdBy) : '';
    const createdAt = r.createdAt != null ? String(r.createdAt) : '';
    const updatedAt = r.updatedAt != null ? String(r.updatedAt) : '';
    const itemsRaw = r.items;
    const items = Array.isArray(itemsRaw)
      ? itemsRaw
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((rr) => ({
            id: rr.id != null ? String(rr.id) : '',
            offerGroupId: rr.offerGroupId != null ? String(rr.offerGroupId) : id,
            productId: rr.productId != null ? String(rr.productId) : '',
            productName: rr.productName != null ? String(rr.productName) : '',
            label: rr.label != null ? String(rr.label) : '',
            quantity:
              typeof rr.quantity === 'number'
                ? rr.quantity
                : parseInt(String(rr.quantity ?? '1'), 10) || 1,
            price: rr.price != null ? (typeof rr.price === 'number' ? rr.price : String(rr.price)) : '0',
            imageUrl: rr.imageUrl != null ? String(rr.imageUrl) : null,
            sortOrder:
              typeof rr.sortOrder === 'number'
                ? rr.sortOrder
                : parseInt(String(rr.sortOrder ?? '0'), 10) || 0,
            status: rr.status != null ? String(rr.status) : 'ACTIVE',
          }))
          .filter((it) => it.id && it.productId && it.label)
      : [];
    out.push({ id, name, status, createdBy, createdAt, updatedAt, items });
  }
  return out;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const productsInput = { page: 1, limit: 200, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

  try {
    const [productsRes, offerGroupsRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/products.list?input=${encodeURIComponent(JSON.stringify(productsInput))}`, opt),
      apiRequest<unknown>(
        `/trpc/marketing.listOfferGroups?input=${encodeURIComponent(
          JSON.stringify({ page: 1, limit: 200, status: 'ACTIVE' }),
        )}`,
        opt,
      ),
    ]);

    const products =
      productsRes.ok
        ? (productsRes.data as { result?: { data?: { products?: Product[] } } })?.result?.data?.products ?? []
        : [];
    const offerGroups = offerGroupsRes.ok ? parseOfferGroups(offerGroupsRes.data) : [];

    const productsLoadError = productsRes.ok ? null : describeApiFetchFailure('Products', productsRes);
    const offerGroupsLoadError = offerGroupsRes.ok ? null : describeApiFetchFailure('Offers', offerGroupsRes);

    const payload: OffersSummaryPayload = {
      offersProducts: products,
      productsLoadError,
      offerGroups,
      offerGroupsLoadError,
    };
    return json({ ok: true as const, ...payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load offers';
    const payload: OffersSummaryPayload = {
      offersProducts: [],
      productsLoadError: msg,
      offerGroups: [],
      offerGroupsLoadError: msg,
    };
    return json({ ok: false as const, error: msg, ...payload });
  }
}

