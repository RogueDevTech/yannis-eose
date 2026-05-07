import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useMemo, useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { PageNotification } from '~/components/ui/page-notification';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { InlineNotification } from '~/components/ui/inline-notification';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
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
  imageUrl?: string | null;
  productId: string;
  productName: string;
};

type OfferGroupPayload = {
  group: { id: string; name: string; status: string };
  items: OfferItem[];
};

type LoaderData = {
  offerId: string;
  returnTo: string;
  group: OfferGroupPayload['group'];
  items: OfferItem[];
  productId: string;
  products: Product[];
  productsLoadError: string | null;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.offers');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
  const offerId = params.id ?? '';
  if (!offerId) throw new Response('Offer id required', { status: 400 });

  const [offerRes, productsRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.getOfferGroup?input=${encodeURIComponent(JSON.stringify({ id: offerId }))}`,
      { method: 'GET', cookie, timeoutMs: 10_000 },
    ),
    apiRequest<unknown>(
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
    ),
  ]);

  if (!offerRes.ok) {
    throw new Response(extractApiErrorMessage(offerRes.data, 'Offer not found'), {
      status: safeStatus(offerRes.status),
    });
  }

  const data = (offerRes.data as { result?: { data?: OfferGroupPayload } })?.result?.data;
  if (!data) throw new Response('Offer not found', { status: 404 });

  const products = productsRes.ok
    ? ((productsRes.data as { result?: { data?: { products?: Product[] } } })?.result?.data?.products ?? [])
    : [];
  const productsLoadError = productsRes.ok
    ? null
    : extractApiErrorMessage(productsRes.data, 'Could not load products. Refresh to retry.');

  const productId = data.items[0]?.productId ?? '';

  return json({
    offerId,
    returnTo,
    group: data.group,
    items: data.items,
    productId,
    products,
    productsLoadError,
  } satisfies LoaderData);
}

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

  let items: Array<{ label: string; quantity: number; imageUrl?: string | null }> = [];
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
        imageUrl: r.imageUrl != null ? String(r.imageUrl) : undefined,
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
        price: 0,
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
  const { returnTo, group, items, productId: initialProductId, products, productsLoadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'updateOffer';

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})`,
      })),
    [products],
  );

  const [name, setName] = useState(group.name);
  const [productId, setProductId] = useState(initialProductId);
  type DraftLine = { label: string; quantity: number; imageUrl?: string };
  const [lines, setLines] = useState<DraftLine[]>(
    items.length > 0
      ? items.map((it) => ({
          label: it.label,
          quantity: it.quantity,
          imageUrl: it.imageUrl ?? undefined,
        }))
      : [{ label: '', quantity: 1 }],
  );

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const gallery = useMemo(
    () => (selectedProduct?.galleryImageUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0),
    [selectedProduct?.galleryImageUrls],
  );
  const basePrice = useMemo(() => {
    const raw = selectedProduct?.baseSalePrice;
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  }, [selectedProduct?.baseSalePrice]);

  const formatMoney = (n: number) =>
    Number.isFinite(n)
      ? n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : '';

  const itemsJson = useMemo(() => JSON.stringify(lines), [lines]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit offer"
        description={
          <>
            Edit the reusable offer package.{' '}
            <Link to={returnTo} className="text-brand-600 dark:text-brand-400 hover:underline">
              Back
            </Link>
          </>
        }
      />

      {actionData?.error ? (
        <PageNotification
          variant="error"
          message={actionData.error}
          durationMs={8000}
          onDismiss={() => {}}
        />
      ) : null}

      {productsLoadError ? (
        <PageNotification
          variant="error"
          message={productsLoadError}
          durationMs={8000}
          onDismiss={() => {}}
        />
      ) : null}

      <Form method="post" className="card p-5 space-y-4">
        <input type="hidden" name="intent" value="updateOffer" />
        <input type="hidden" name="productId" value={productId} readOnly />
        <input type="hidden" name="itemsJson" value={itemsJson} readOnly />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            name="name"
            label="Offer name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SearchableSelect
            id="offer-product"
            label="Product"
            value={productId}
            onChange={(v) => {
              setProductId(v);
              setLines((prev) => prev.map((l) => ({ ...l, imageUrl: undefined })));
            }}
            options={productOptions}
            placeholder="Select product…"
            searchPlaceholder="Search products…"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-app-fg">Offer items</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((p) => p.concat([{ label: '', quantity: 1 }]))}
            >
              + Add line
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((it, idx) => (
              <div key={idx} className="rounded-xl border border-app-border bg-app-surface p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <TextInput
                    label="Label"
                    value={it.label}
                    onChange={(e) =>
                      setLines((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Buy 1 get 1 free"
                  />
                  <TextInput
                    label="Qty"
                    inputMode="numeric"
                    value={String(it.quantity)}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setLines((p) =>
                        p.map((x, i) => (i === idx ? { ...x, quantity: Number.isFinite(n) && n > 0 ? n : 1 } : x)),
                      );
                    }}
                  />
                  <TextInput
                    label="Total price (₦)"
                    value={Number.isFinite(basePrice) ? formatMoney(basePrice * (it.quantity ?? 1)) : ''}
                    disabled
                    hint={
                      Number.isFinite(basePrice)
                        ? `Unit: ₦${formatMoney(basePrice)} × Qty`
                        : 'Select a product to inherit unit price'
                    }
                  />
                </div>

                {!productId ? null : gallery.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-app-fg-muted mb-2">Pick image for this line</p>
                    <div className="flex flex-wrap gap-2">
                      {gallery.map((url) => {
                        const selected = it.imageUrl === url;
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() =>
                              setLines((p) => p.map((x, i) => (i === idx ? { ...x, imageUrl: url } : x)))
                            }
                            className={[
                              'w-16 h-16 rounded-lg border overflow-hidden bg-app-hover shrink-0',
                              selected
                                ? 'border-brand-500 ring-2 ring-brand-500/30'
                                : 'border-app-border hover:border-app-border/80',
                            ].join(' ')}
                          >
                            <img src={url} alt="" className="w-full h-full object-cover" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <InlineNotification variant="info" message="This product has no gallery images yet." />
                )}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                  >
                    Remove line
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link to={returnTo} className="btn-secondary btn-sm">
            Cancel
          </Link>
          <Button type="submit" variant="primary" size="sm" loading={busy} loadingText="Saving…">
            Save changes
          </Button>
        </div>
      </Form>
    </div>
  );
}
