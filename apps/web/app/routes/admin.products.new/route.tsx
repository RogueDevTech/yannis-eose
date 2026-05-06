import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useActionData, useLoaderData } from '@remix-run/react';
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

interface LoaderData {
  categories: CategoryOption[];
}

function parseCurrencyToNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.create');
  const cookie = getSessionCookie(request);

  const categoriesRes = await apiRequest<unknown>('/trpc/productCategories.listActive', { method: 'GET', cookie });

  let categories: CategoryOption[] = [];
  if (categoriesRes.ok) {
    const trpcData = categoriesRes.data as { result?: { data?: CategoryOption[] } };
    categories = trpcData?.result?.data ?? [];
  }

  return { categories } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const name = formData.get('name')?.toString() ?? '';
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

  if (!name || !costPrice || baseSalePrice == null) {
    return json({ error: 'Name, list price, and cost price are required' }, { status: 400 });
  }

  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/products.create', {
    method: 'POST',
    cookie,
    body: {
      name,
      baseSalePrice,
      costPrice,
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

  return redirect('/admin/products');
}

export default function NewProductRoute() {
  const { categories } = useLoaderData<LoaderData>();
  const actionData = useActionData<typeof action>();
  return <ProductCreatePage actionData={actionData} categories={categories} />;
}
