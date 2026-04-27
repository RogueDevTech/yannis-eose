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
  const description = formData.get('description')?.toString() || undefined;
  const category = formData.get('category')?.toString() || undefined;
  const categoryId = formData.get('categoryId')?.toString() || null;
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

  // Validate each offer has required fields
  for (const offer of offers) {
    if (!offer.label || !offer.price || !offer.qty) {
      return json({ error: 'Each offer must have a label, quantity, and price' }, { status: 400 });
    }
  }

  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/products.create', {
    method: 'POST',
    cookie,
    body: {
      name,
      offers,
      costPrice,
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
