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
  await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);

  const input = { page: 1, limit: 50, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };
  const productsPromise = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  ).then((res) => {
    if (!res.ok) return { products: [] as Product[], total: 0 };
    const trpcData = res.data as { result?: { data?: { products: Product[]; pagination: { total: number } } } };
    const data = trpcData?.result?.data;
    return { products: data?.products ?? [], total: data?.pagination?.total ?? 0 };
  }).catch(() => ({ products: [] as Product[], total: 0 }));

  return defer({ products: productsPromise });
}

export default function ProductsRoute() {
  const { products } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={products} skeleton="table">
      {(data) => <ProductsListPage products={data.products} total={data.total} />}
    </DeferredSection>
  );
}
