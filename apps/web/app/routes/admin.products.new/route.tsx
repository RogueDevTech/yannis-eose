import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useActionData, useLoaderData } from '@remix-run/react';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermission, redirectIfUnauthorized, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { ProductCreatePage } from '~/features/products/ProductCreatePage';

export const meta: MetaFunction = () => [
  { title: 'Add Product — Yannis EOSE' },
];

interface CategoryOption {
  id: string;
  name: string;
  brandName: string;
}

function parseCurrencyToNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.create');
  const cookie = getSessionCookie(request);

  const [categoriesPromise, productsRes] = await Promise.all([
    apiRequest<unknown>('/trpc/productCategories.listActive', {
      method: 'GET',
      cookie,
    })
      .then((res) => {
        if (!res.ok) return [] as CategoryOption[];
        const trpcData = res.data as { result?: { data?: CategoryOption[] } };
        return trpcData?.result?.data ?? [];
      })
      .catch(() => [] as CategoryOption[]),
    apiRequest<unknown>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  let allProducts: Array<{ id: string; name: string }> = [];
  if (productsRes.ok) {
    const pData = productsRes.data as { result?: { data?: { products?: Array<{ id: string; name: string }> } } };
    allProducts = (pData?.result?.data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  return defer({ categoriesPromise, allProducts });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const name = formData.get('name')?.toString() ?? '';
  // Cost price and base/list price are no longer collected on the form — cost is
  // a reference value only (real COGS is FIFO landed cost on shipments) and base
  // price auto-syncs to the cheapest offer. Both remain optional for imports.
  const costPrice = formData.get('costPrice')?.toString() ?? '';
  const baseSalePriceRaw = formData.get('baseSalePrice')?.toString() ?? '';
  const description = formData.get('description')?.toString() || undefined;
  const category = formData.get('category')?.toString() || undefined;
  const categoryId = formData.get('categoryId')?.toString() || null;

  let galleryImageUrls: unknown;
  try {
    galleryImageUrls = JSON.parse(formData.get('galleryImageUrls')?.toString() ?? '[]');
  } catch {
    return json({ error: 'Invalid gallery images data' }, { status: 400 });
  }
  if (!Array.isArray(galleryImageUrls) || !galleryImageUrls.every((u) => typeof u === 'string')) {
    return json({ error: 'Gallery images must be a JSON array of URL strings' }, { status: 400 });
  }

  const baseSalePrice = parseCurrencyToNumber(baseSalePriceRaw);

  if (!name) {
    return json({ error: 'Product name is required' }, { status: 400 });
  }

  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/products.create', {
    method: 'POST',
    cookie,
    body: {
      name,
      // Only forward prices when actually provided (e.g. via import); the create
      // form omits them. Base price defaults to 0 server-side; cost stays null.
      ...(baseSalePrice != null ? { baseSalePrice } : {}),
      ...(costPrice ? { costPrice } : {}),
      galleryImageUrls,
      description,
      category,
      categoryId: categoryId || null,
    },
  });

  redirectIfUnauthorized(res, '/admin/products/new');

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to create product') },
      { status: safeStatus(res.status) },
    );
  }

  // If bundle type, set bundle components on the newly created product
  const productType = formData.get('productType')?.toString();
  if (productType === 'bundle') {
    const createdData = res.data as { result?: { data?: { id?: string } } };
    const newProductId = createdData?.result?.data?.id;
    if (newProductId) {
      let bundleComponents: Array<{ componentProductId: string; quantity: number }> = [];
      try {
        bundleComponents = JSON.parse(formData.get('bundleComponents')?.toString() ?? '[]');
      } catch { /* ignore parse errors */ }

      if (bundleComponents.length > 0) {
        await apiRequest<unknown>('/trpc/products.setBundleComponents', {
          method: 'POST',
          cookie,
          body: { productId: newProductId, components: bundleComponents },
        });
      }
    }
  }

  return redirect('/admin/products');
}

export default function NewProductRoute() {
  const { categoriesPromise, allProducts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <ProductCreatePage
      actionData={actionData}
      categoriesPromise={categoriesPromise}
      allProducts={allProducts}
    />
  );
}
