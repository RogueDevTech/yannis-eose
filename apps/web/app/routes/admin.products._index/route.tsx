import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
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
    user.role === 'SUPER_ADMIN' || (user.permissions ?? []).includes('products.update');

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

  return defer({ products: productsPromise, canEditProduct });
}

export default function ProductsRoute() {
  const { products, canEditProduct } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={products} skeleton="table">
      {(data) => (
        <ProductsListPage
          products={data.products}
          total={data.total}
          page={data.page}
          totalPages={data.totalPages}
          canEditProduct={canEditProduct}
        />
      )}
    </DeferredSection>
  );
}
