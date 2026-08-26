import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requireRole } from '~/lib/api.server';
import { BulkImportPage } from '~/features/orders/BulkImportPage';

export const meta: MetaFunction = () => [
  { title: 'Bulk import orders — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ['SUPER_ADMIN', 'SUPPORT']);
  const cookie = getSessionCookie(request);

  const [productsRes, mbRes, csRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 500, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'MEDIA_BUYER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'CS_CLOSER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  type ProductRow = { id: string; name: string };
  let products: Array<{ id: string; name: string }> = [];
  if (productsRes.ok) {
    const data = productsRes.data as { result?: { data?: { products?: ProductRow[] } } };
    products = (data?.result?.data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  type UserRow = { id: string; name: string; role: string };
  let mediaBuyers: Array<{ id: string; name: string }> = [];
  if (mbRes.ok) {
    const data = mbRes.data as { result?: { data?: { users?: UserRow[] } } };
    mediaBuyers = (data?.result?.data?.users ?? [])
      .filter((u) => u.role === 'MEDIA_BUYER')
      .map((u) => ({ id: u.id, name: u.name }));
  }

  let csAgents: Array<{ id: string; name: string }> = [];
  if (csRes.ok) {
    const data = csRes.data as { result?: { data?: { users?: UserRow[] } } };
    csAgents = (data?.result?.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }));
  }

  return json({ products, mediaBuyers, csAgents });
}

export default function BulkImportRoute() {
  const { products, mediaBuyers, csAgents } = useLoaderData<typeof loader>();
  return (
    <BulkImportPage
      products={products}
      mediaBuyers={mediaBuyers}
      csAgents={csAgents}
      backHref="/admin/sales/orders"
    />
  );
}
