import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { cachedClientLoader } from '~/lib/loader-cache';
import { OfferForm } from '~/features/campaigns/OfferForm';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { editableOfferCurrencyCodes } from '~/lib/offer-currency-scope';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { Product } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [{ title: 'Create offer — Yannis EOSE' }];

function normalizeReturnTo(raw: string | null): string {
  if (!raw) return '/admin/products?tab=offers';
  // Only allow in-app paths.
  if (!raw.startsWith('/')) return '/admin/products?tab=offers';
  return raw;
}

type ProductsPayload = { products: Product[]; productsLoadError: string | null };

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));

  // Multi-country: which currencies may this user set prices for? null = all.
  const currentUser = await getCurrentUser(request);
  const editableCurrencyCodes = currentUser
    ? editableOfferCurrencyCodes(currentUser)
    : ['NGN'];

  const productsListInput = {
    page: 1,
    limit: 100,
    status: 'ACTIVE' as const,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  };

  // App Shell pattern — defer the products fetch so the form chrome renders
  // instantly. Only the product dropdown (and the gallery picker that depends
  // on the chosen product) waits for this promise.
  const productsPromise: Promise<ProductsPayload> = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify(productsListInput))}`,
    { method: 'GET', cookie, timeoutMs: 15_000 },
  )
    .then((res) => {
      if (!res.ok) {
        return {
          products: [],
          productsLoadError: extractApiErrorMessage(res.data, 'Could not load products. Refresh to retry.'),
        };
      }
      const products = ((res.data as { result?: { data?: { products?: Product[] } } })?.result?.data?.products ?? []);
      return { products, productsLoadError: null };
    })
    .catch(() => ({ products: [], productsLoadError: 'Could not load products. Refresh to retry.' }));

  return defer({ returnTo, editableCurrencyCodes, productsPromise });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Unauthorized' }, { status: 401 });

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

  const res = await apiRequest<unknown>('/trpc/marketing.createOfferGroup', {
    method: 'POST',
    cookie,
    body: {
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
    return json({ error: extractApiErrorMessage(res.data, 'Failed to create offer') }, { status: safeStatus(res.status) });
  }

  const createdId =
    (res.data as { result?: { data?: { group?: { id?: string } } } })?.result?.data?.group?.id ??
    '';

  const dest = new URL(returnTo, url.origin);
  if (createdId) {
    dest.searchParams.set('offerGroupId', createdId);
    dest.searchParams.set('createdOfferId', createdId);
  }
  return redirect(dest.pathname + dest.search);
}

export default function CreateOfferRoute() {
  const { returnTo, editableCurrencyCodes, productsPromise } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'createOffer';

  // Bridge the deferred products payload into local state so the rest of the
  // form (which is rendered eagerly) can derive selectedProduct + gallery +
  // basePrice without being wrapped in <Suspense>. While `products` is null,
  // the product picker shows a "Loading…" state but every other input is
  // immediately interactive.
  const [products, setProducts] = useState<Product[] | null>(
    Array.isArray(productsPromise)
      ? (productsPromise as unknown as ProductsPayload).products ?? []
      : null,
  );
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (Array.isArray(productsPromise)) {
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

  return (
    <OfferForm
      mode="create"
      products={products}
      productsLoadError={productsLoadError}
      returnTo={returnTo}
      busy={busy}
      error={actionData?.error}
      editableCurrencyCodes={editableCurrencyCodes}
    />
  );
}

