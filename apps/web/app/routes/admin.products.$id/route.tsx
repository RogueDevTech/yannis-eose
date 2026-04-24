import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useActionData, useLoaderData, useSearchParams } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, redirectIfUnauthorized, safeStatus } from '~/lib/api.server';
import { ProductEditPage } from '~/features/products/ProductEditPage';
import { ProductViewPage } from '~/features/products/ProductViewPage';
import type { Product } from '~/features/products/types';

export const meta: MetaFunction<typeof loader> = ({ data, location }) => {
  if (!data?.product) return [{ title: 'Product — Yannis EOSE' }];
  const mode = new URLSearchParams(location?.search ?? '').get('mode');
  const inEditMode = mode === 'edit';
  return [
    { title: inEditMode ? `${data.product.name} — Edit Product` : `${data.product.name} — Yannis EOSE` },
  ];
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

function mapApiProductToProduct(apiProduct: Record<string, unknown>): Product {
  const offers = (apiProduct.offers as Array<{ label: string; qty: number; price: string }>) ?? [];
  return {
    id: String(apiProduct.id ?? ''),
    name: String(apiProduct.name ?? ''),
    description: apiProduct.description != null ? String(apiProduct.description) : null,
    offers: offers.map((o) => ({
      label: o?.label ?? '',
      qty: typeof o?.qty === 'number' ? o.qty : parseInt(String(o?.qty), 10) || 1,
      price: String(o?.price ?? ''),
    })),
    baseSalePrice: String(apiProduct.baseSalePrice ?? apiProduct.base_sale_price ?? '0'),
    costPrice: apiProduct.costPrice != null || apiProduct.cost_price != null
      ? String(apiProduct.costPrice ?? apiProduct.cost_price ?? '')
      : null,
    category: apiProduct.category != null ? String(apiProduct.category) : null,
    categoryId: apiProduct.categoryId != null || apiProduct.category_id != null
      ? String(apiProduct.categoryId ?? apiProduct.category_id ?? '')
      : null,
    categoryName: apiProduct.categoryName != null ? String(apiProduct.categoryName) : null,
    brandName: apiProduct.brandName != null ? String(apiProduct.brandName) : null,
    status: String(apiProduct.status ?? 'ACTIVE'),
    createdAt: String(apiProduct.createdAt ?? apiProduct.created_at ?? ''),
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);
  const productId = params['id'];

  if (!productId) {
    throw new Response('Product ID required', { status: 400 });
  }

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
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || (user.permissions ?? []).includes('products.update');

  return { product, categories, canEditProduct } satisfies LoaderData;
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'products.update');
  const cookie = getSessionCookie(request);
  const productId = params['id'];

  if (!productId) {
    throw new Response('Product ID required', { status: 400 });
  }

  const formData = await request.formData();
  const name = formData.get('name')?.toString() ?? '';
  const costPrice = formData.get('costPrice')?.toString() ?? '';
  const description = formData.get('description')?.toString() || undefined;
  const category = formData.get('category')?.toString() || undefined;
  const categoryId = formData.get('categoryId')?.toString() || null;
  const status = formData.get('status')?.toString() as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | undefined;
  const offersRaw = formData.get('offers')?.toString() ?? '[]';

  let offers: Array<{ label: string; qty: number; price: string }>;
  try {
    offers = JSON.parse(offersRaw);
  } catch {
    return json({ error: 'Invalid offers data' }, { status: 400 });
  }

  if (!name || !costPrice || offers.length === 0) {
    return json({ error: 'Name, cost price, and at least one offer are required' }, { status: 400 });
  }

  for (const offer of offers) {
    if (!offer.label || !offer.price || !offer.qty) {
      return json({ error: 'Each offer must have a label, quantity, and price' }, { status: 400 });
    }
  }

  const res = await apiRequest<unknown>('/trpc/products.update', {
    method: 'POST',
    cookie,
    body: {
      productId,
      name,
      offers,
      costPrice,
      description: description ?? null,
      category: category ?? null,
      categoryId: categoryId || null,
      status: status ?? undefined,
    },
  });

  redirectIfUnauthorized(res, `/admin/products/${productId}`);

  if (!res.ok) {
    const errorData = res.data as { error?: { message?: string } };
    return json(
      { error: errorData?.error?.message ?? 'Failed to update product' },
      { status: safeStatus(res.status) },
    );
  }

  return redirect(`/admin/products/${productId}`);
}

export default function ProductDetailRoute() {
  const { product, categories, canEditProduct } = useLoaderData<LoaderData>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const isEditMode = mode === 'edit' && canEditProduct;

  if (isEditMode) {
    return (
      <ProductEditPage
        product={product}
        categories={categories}
        actionData={actionData}
        productId={product.id}
      />
    );
  }

  return <ProductViewPage product={product} canEditProduct={canEditProduct} />;
}
