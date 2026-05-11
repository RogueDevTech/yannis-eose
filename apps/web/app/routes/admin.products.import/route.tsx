import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { ProductsImportPage } from '../../features/products/ProductsImportPage';
import type { CategoryInfo } from '../../features/products/products-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import products — Yannis EOSE' },
];

/**
 * Loader for `/admin/products/import` — dedicated bulk-import page. Loads the
 * active category list up-front (the editor needs it for category resolution
 * on every keystroke), so the page is ready to validate inline from the
 * moment the operator drops a sheet.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.create');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/productCategories.listActive', {
    method: 'GET',
    cookie,
  });
  let categories: CategoryInfo[] = [];
  if (res.ok) {
    const data = res.data as {
      result?: { data?: Array<{ id: string; name: string; status?: string }> };
    };
    categories = (data?.result?.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  }

  return json({ categories });
}

export default function ProductsImportRoute() {
  const { categories } = useLoaderData<typeof loader>();
  return <ProductsImportPage categories={categories} />;
}
