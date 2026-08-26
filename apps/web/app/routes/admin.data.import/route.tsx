import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { ImportPage } from '~/features/data/ImportPage';

export const meta: MetaFunction = () => [
  { title: 'Import — Yannis EOSE' },
];

// The Orders card renders the resumable BulkImportPage, which resolves product /
// media buyer / CS / branch / currency per row from the sheet and creates a
// background job (posts to bulkImport.createJob client-side). We still load the
// product/MB/CS lists here for a future code-reference legend.
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'data.import');
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

export default function ImportRoute() {
  const { products, mediaBuyers, csAgents } = useLoaderData<typeof loader>();
  return <ImportPage products={products} mediaBuyers={mediaBuyers} csAgents={csAgents} />;
}
