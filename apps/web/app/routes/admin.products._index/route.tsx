import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { ProductsListPage } from '~/features/products/ProductsListPage';
import type { Product } from '~/features/products/types';

export const meta: MetaFunction = () => [
  { title: 'Products — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/products.list', {
    method: 'GET',
    cookie,
  });

  if (!res.ok) {
    return json({ products: [] as Product[], total: 0 });
  }

  const trpcData = res.data as { result?: { data?: { products: Product[]; pagination: { total: number } } } };
  const data = trpcData?.result?.data;

  return json({
    products: data?.products ?? [],
    total: data?.pagination?.total ?? 0,
  });
}

export default function ProductsRoute() {
  const data = useLoaderData<typeof loader>();
  return <ProductsListPage {...data} />;
}
