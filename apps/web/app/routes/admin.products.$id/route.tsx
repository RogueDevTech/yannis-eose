import * as React from 'react';
import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, useActionData, useLoaderData, useSearchParams } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, redirectIfUnauthorized, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { ProductEditPage } from '~/features/products/ProductEditPage';
import { ProductViewPage } from '~/features/products/ProductViewPage';
import type { Product } from '~/features/products/types';
import { ProductDetailLoadingShell } from '~/features/products/ProductsDeferredLoadingShells';

export const meta: MetaFunction<typeof loader> = ({ location }) => {
  const mode = new URLSearchParams(location?.search ?? '').get('mode');
  const inEditMode = mode === 'edit';
  return [{ title: inEditMode ? 'Edit Product — Yannis EOSE' : 'Product — Yannis EOSE' }];
};

interface CategoryOption {
  id: string;
  name: string;
  brandName: string;
}

interface LoaderData {
  product: Product;
  categories: CategoryOption[];
  canEditProduct: boolean;
}

function canonicalPerm(p: string) {
  return p.trim().replace(/_/g, '.');
}

function mapGalleryUrls(apiProduct: Record<string, unknown>): string[] {
  const raw = apiProduct.galleryImageUrls ?? apiProduct.gallery_image_urls;
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === 'string' && u.length > 0);
}

function mapApiProductToProduct(apiProduct: Record<string, unknown>): Product {
  const offers =
    (apiProduct.offers as Array<{ label: string; qty: number; price: string; imageUrls?: unknown }>) ?? [];
  return {
    id: String(apiProduct.id ?? ''),
    name: String(apiProduct.name ?? ''),
    description: apiProduct.description != null ? String(apiProduct.description) : null,
    galleryImageUrls: mapGalleryUrls(apiProduct),
    offers: offers.map((o) => {
      const raw = o?.imageUrls;
      const imageUrls = Array.isArray(raw)
        ? raw.filter((u): u is string => typeof u === 'string' && u.length > 0)
        : [];
      return {
        label: o?.label ?? '',
        qty: typeof o?.qty === 'number' ? o.qty : parseInt(String(o?.qty), 10) || 1,
        price: String(o?.price ?? ''),
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
      };
    }),
    baseSalePrice: String(apiProduct.baseSalePrice ?? apiProduct.base_sale_price ?? '0'),
    costPrice:
      apiProduct.costPrice != null || apiProduct.cost_price != null
        ? String(apiProduct.costPrice ?? apiProduct.cost_price ?? '')
        : null,
    category: apiProduct.category != null ? String(apiProduct.category) : null,
    categoryId:
      apiProduct.categoryId != null || apiProduct.category_id != null
        ? String(apiProduct.categoryId ?? apiProduct.category_id ?? '')
        : null,
    categoryName: apiProduct.categoryName != null ? String(apiProduct.categoryName) : null,
    brandName: apiProduct.brandName != null ? String(apiProduct.brandName) : null,
    status: String(apiProduct.status ?? 'ACTIVE'),
    createdAt: String(apiProduct.createdAt ?? apiProduct.created_at ?? ''),
  };
}

function parseCurrencyToNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);
  const productId = params['id'];

  if (!productId) {
    throw new Response('Product ID required', { status: 400 });
  }

  const pageData = (async (): Promise<LoaderData> => {
    const [productRes, categoriesRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/products.getById?input=${encodeURIComponent(JSON.stringify({ productId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/productCategories.listActive', { method: 'GET', cookie }),
    ]);

    if (!productRes.ok) {
      throw new Response('Product not found', { status: 404 });
    }

    const productData = productRes.data as { result?: { data?: Record<string, unknown> } };
    const apiProduct = productData?.result?.data;

    if (!apiProduct) {
      throw new Response('Product not found', { status: 404 });
    }

    let categories: CategoryOption[] = [];
    if (categoriesRes.ok) {
      const catData = categoriesRes.data as { result?: { data?: CategoryOption[] } };
      categories = catData?.result?.data ?? [];
    }

    const product = mapApiProductToProduct(apiProduct);
    const canEditProduct =
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      (user.permissions ?? []).map(canonicalPerm).includes('products.update');

    return { product, categories, canEditProduct };
  })();

  return defer({ pageData });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const productId = params['id'];

  if (!productId) {
    throw new Response('Product ID required', { status: 400 });
  }

  const formData = await request.formData();
  await requirePermission(request, 'products.update');

  const name = formData.get('name')?.toString() ?? '';
  const baseSalePriceRaw = formData.get('baseSalePrice')?.toString() ?? '';
  const costPrice = formData.get('costPrice')?.toString() ?? '';
  const description = formData.get('description')?.toString() || undefined;
  const category = formData.get('category')?.toString() || undefined;
  const categoryId = formData.get('categoryId')?.toString() || null;
  const status = formData.get('status')?.toString() as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | undefined;

  let galleryImageUrls: string[] = [];
  try {
    galleryImageUrls = JSON.parse(formData.get('galleryImageUrls')?.toString() ?? '[]');
    if (!Array.isArray(galleryImageUrls)) {
      throw new Error('not array');
    }
    galleryImageUrls = galleryImageUrls.filter((u): u is string => typeof u === 'string');
  } catch {
    return json({ error: 'Invalid gallery images data' }, { status: 400 });
  }

  const baseParsed = parseCurrencyToNumber(baseSalePriceRaw);
  if (!name || !costPrice || baseParsed == null) {
    return json({ error: 'Name, list price, and cost price are required' }, { status: 400 });
  }

  const res = await apiRequest<unknown>('/trpc/products.update', {
    method: 'POST',
    cookie,
    body: {
      productId,
      name,
      baseSalePrice: baseParsed,
      costPrice,
      galleryImageUrls,
      description: description ?? null,
      category: category ?? null,
      categoryId: categoryId || null,
      status: status ?? undefined,
    },
  });

  redirectIfUnauthorized(res, `/admin/products/${productId}`);

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to update product') },
      { status: safeStatus(res.status) },
    );
  }

  return redirect(`/admin/products/${productId}`, { status: 303 });
}

function ProductDetailBody({
  product,
  categories,
  canEditProduct,
}: LoaderData) {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const isEditMode = mode === 'edit' && canEditProduct;

  if (isEditMode) {
    return (
      <ProductEditPage
        product={product}
        categories={categories}
        actionData={
          typeof actionData === 'object' && actionData !== null && 'error' in actionData
            ? (actionData as { error?: string })
            : undefined
        }
        productId={product.id}
      />
    );
  }

  return <ProductViewPage product={product} canEditProduct={canEditProduct} />;
}

export default function ProductDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <React.Suspense fallback={<ProductDetailLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => <ProductDetailBody {...data} />}
      </Await>
    </React.Suspense>
  );
}
