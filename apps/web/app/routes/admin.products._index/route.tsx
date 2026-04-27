import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { DeferredSection } from '~/components/ui/deferred-section';
import { ProductsListPage } from '~/features/products/ProductsListPage';
import type { Product } from '~/features/products/types';

export const meta: MetaFunction = () => [
  { title: 'Products — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const pageParam = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const canEditProduct =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || (user.permissions ?? []).includes('products.update');
  const canCreateProduct =
    user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || (user.permissions ?? []).includes('products.create');

  const input = { page, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };
  const productsPromise = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  ).then((res) => {
    if (!res.ok) return { products: [] as Product[], total: 0, page, totalPages: 0 };
    const trpcData = res.data as {
      result?: { data?: { products: Product[]; pagination: { total: number; page: number; totalPages: number } } };
    };
    const data = trpcData?.result?.data;
    return {
      products: data?.products ?? [],
      total: data?.pagination?.total ?? 0,
      page: data?.pagination?.page ?? page,
      totalPages: data?.pagination?.totalPages ?? 0,
    };
  }).catch(() => ({ products: [] as Product[], total: 0, page, totalPages: 0 }));

  return defer({ products: productsPromise, canEditProduct, canCreateProduct });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'archiveProduct') {
    const id = formData.get('id')?.toString() ?? '';
    if (!id) return json({ error: 'Product id required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/products.update', {
      method: 'POST',
      cookie,
      body: { id, status: 'ARCHIVED' },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive product') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function ProductsRoute() {
  const { products, canEditProduct, canCreateProduct } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={products} skeleton="table">
      {(data) => (
        <ProductsListPage
          products={data.products}
          total={data.total}
          page={data.page}
          totalPages={data.totalPages}
          canEditProduct={canEditProduct}
          canCreateProduct={canCreateProduct}
        />
      )}
    </DeferredSection>
  );
}
