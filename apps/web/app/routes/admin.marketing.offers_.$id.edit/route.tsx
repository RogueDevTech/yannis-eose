import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { cachedClientLoader } from '~/lib/loader-cache';
import { OfferForm } from '~/features/campaigns/OfferForm';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { editableOfferCurrencyCodes } from '~/lib/offer-currency-scope';
import type { Product } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [{ title: 'Edit offer — Yannis EOSE' }];

function normalizeReturnTo(raw: string | null): string {
  if (!raw) return '/admin/products?tab=offers';
  if (!raw.startsWith('/')) return '/admin/products?tab=offers';
  return raw;
}

type OfferItem = {
  id: string;
  label: string;
  quantity: number;
  price?: string | number | null;
  imageUrl?: string | null;
  productId: string;
  productName: string;
  /** Non-default currency prices (code → price string). From getOfferGroup. */
  pricesByCurrency?: Record<string, string>;
};

type OfferGroupPayload = {
  group: { id: string; name: string; status: string };
  items: OfferItem[];
};

type ProductsPayload = { products: Product[]; productsLoadError: string | null };

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
  const offerId = params.id ?? '';
  if (!offerId) throw new Response('Offer id required', { status: 400 });

  // Sync — the offer group itself is required to render the form (current
  // values, line items). Without it there's nothing to edit.
  const offerRes = await apiRequest<unknown>(
    `/trpc/marketing.getOfferGroup?input=${encodeURIComponent(JSON.stringify({ id: offerId }))}`,
    { method: 'GET', cookie, timeoutMs: 10_000 },
  );

  if (!offerRes.ok) {
    throw new Response(extractApiErrorMessage(offerRes.data, 'Offer not found'), {
      status: safeStatus(offerRes.status),
    });
  }

  const data = (offerRes.data as { result?: { data?: OfferGroupPayload } })?.result?.data;
  if (!data) throw new Response('Offer not found', { status: 404 });

  const productId = data.items[0]?.productId ?? '';

  // Multi-country: which currencies may THIS user edit? null = all (view-all).
  // Drives read-only locking of out-of-scope price inputs; server re-enforces.
  const currentUser = await getCurrentUser(request);
  const editableCurrencyCodes = currentUser
    ? editableOfferCurrencyCodes(currentUser)
    : ['NGN'];

  // App Shell pattern — defer the products fetch so the form chrome (current
  // offer name, line items with labels and quantities) renders instantly.
  // Only the Product picker (and product-derived gallery + base price) wait.
  const productsPromise: Promise<ProductsPayload> = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(
      JSON.stringify({
        page: 1,
        limit: 100,
        status: 'ACTIVE',
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    )}`,
    { method: 'GET', cookie, timeoutMs: 15_000 },
  )
    .then((res) => {
      if (!res.ok) {
        return {
          products: [],
          productsLoadError: extractApiErrorMessage(res.data, 'Could not load products. Refresh to retry.'),
        };
      }
      return {
        products:
          ((res.data as { result?: { data?: { products?: Product[] } } })?.result?.data?.products ?? []),
        productsLoadError: null,
      };
    })
    .catch(() => ({ products: [], productsLoadError: 'Could not load products. Refresh to retry.' }));

  return defer({
    offerId,
    returnTo,
    group: data.group,
    items: data.items,
    productId,
    editableCurrencyCodes,
    productsPromise,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Unauthorized' }, { status: 401 });

  const offerId = params.id ?? '';
  if (!offerId) return json({ error: 'Offer id required' }, { status: 400 });

  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
  const formData = await request.formData();

  const name = formData.get('name')?.toString()?.trim() ?? '';
  const productId = formData.get('productId')?.toString() ?? '';
  if (!name) return json({ error: 'Offer name is required' }, { status: 400 });
  if (!productId) return json({ error: 'Product is required' }, { status: 400 });

  const cleanPrices = (raw: unknown): Record<string, number> | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, number> = {};
    for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(String(v ?? '').replace(/,/g, '').trim());
      if (Number.isFinite(n) && n > 0) out[code.toUpperCase()] = n;
    }
    return Object.keys(out).length ? out : undefined;
  };

  let items: Array<{ label: string; quantity: number; price: number; imageUrl?: string | null; prices?: Record<string, number> }> = [];
  try {
    const raw = JSON.parse(formData.get('itemsJson')?.toString() ?? '[]');
    if (!Array.isArray(raw)) throw new Error('bad');
    items = raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((r) => ({
        label: r.label != null ? String(r.label).trim() : '',
        quantity:
          typeof r.quantity === 'number' && Number.isFinite(r.quantity)
            ? r.quantity
            : parseInt(String(r.quantity ?? '1'), 10) || 1,
        price: Number(String(r.price ?? '0').replace(/,/g, '').trim()) || 0,
        imageUrl: r.imageUrl != null ? String(r.imageUrl) : undefined,
        prices: cleanPrices(r.prices),
      }))
      .filter((it) => it.label.length > 0);
  } catch {
    return json({ error: 'Invalid items payload' }, { status: 400 });
  }
  if (items.length === 0) return json({ error: 'Add at least one offer item' }, { status: 400 });

  const res = await apiRequest<unknown>('/trpc/marketing.updateOfferGroup', {
    method: 'POST',
    cookie,
    body: {
      id: offerId,
      name,
      items: items.map((it, idx) => ({
        productId,
        label: it.label,
        quantity: it.quantity,
        price: it.price,
        ...(it.prices ? { prices: it.prices } : {}),
        imageUrl: it.imageUrl ?? undefined,
        sortOrder: idx,
      })),
    },
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to update offer') },
      { status: safeStatus(res.status) },
    );
  }

  const dest = new URL(returnTo, url.origin);
  dest.searchParams.set('offerGroupId', offerId);
  dest.searchParams.set('updatedOfferId', offerId);
  return redirect(dest.pathname + dest.search);
}

export default function EditOfferRoute() {
  const { returnTo, group, items, productId: initialProductId, editableCurrencyCodes, productsPromise } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'updateOffer';

  // Bridge deferred products to local state — form chrome (offer name, line
  // labels + quantities, total price column) is fully editable from first
  // paint; only the Product picker briefly shows "Loading…".
  const [products, setProducts] = useState<Product[] | null>(
    Array.isArray((productsPromise as unknown as ProductsPayload).products)
      ? (productsPromise as unknown as ProductsPayload).products
      : null,
  );
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);
  useEffect(() => {
    const isResolved =
      typeof productsPromise === 'object' &&
      productsPromise != null &&
      !('then' in (productsPromise as object));
    if (isResolved) {
      const payload = productsPromise as unknown as ProductsPayload;
      setProducts(payload.products);
      setProductsLoadError(payload.productsLoadError ?? null);
      return;
    }
    let cancelled = false;
    Promise.resolve(productsPromise)
      .then((payload) => {
        if (cancelled) return;
        setProducts(payload.products);
        setProductsLoadError(payload.productsLoadError ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setProducts([]);
        setProductsLoadError('Could not load products. Refresh to retry.');
      });
    return () => {
      cancelled = true;
    };
  }, [productsPromise]);

  const initialLines = (items.length > 0 ? items : []).map((it) => ({
    label: it.label,
    quantity: it.quantity,
    price: it.price != null && Number(it.price) > 0 ? String(Number(it.price)) : '',
    imageUrl: it.imageUrl ?? undefined,
    prices: it.pricesByCurrency ?? {},
  }));

  return (
    <OfferForm
      mode="edit"
      products={products}
      productsLoadError={productsLoadError}
      returnTo={returnTo}
      busy={busy}
      error={actionData?.error}
      initialName={group.name}
      initialProductId={initialProductId}
      initialLines={initialLines}
      editableCurrencyCodes={editableCurrencyCodes}
    />
  );
}
