import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { BulkImportPage } from '~/features/orders/BulkImportPage';

export const meta: MetaFunction = () => [
  { title: 'Import orders — Yannis EOSE' },
];

/**
 * The orders importer, on its own page: `/admin/data/import/orders`.
 *
 * Previously this rendered inline underneath the type-picker cards on
 * `/admin/data/import`, which stacked two page headers ("Import" above "Bulk
 * import orders") in one view. The picker is now purely a menu and each import
 * type gets a real page, so the header, back link and browser history all
 * behave normally.
 *
 * The trailing `_` keeps this out of the picker route's nesting. It is a STATIC
 * segment, so it wins over the sibling dynamic `import_.$jobId` route — no
 * conflict with `/admin/data/import/:jobId`.
 */
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

export default function ImportOrdersRoute() {
  const { products, mediaBuyers, csAgents } = useLoaderData<typeof loader>();
  return (
    <BulkImportPage
      products={products}
      mediaBuyers={mediaBuyers}
      csAgents={csAgents}
      // Back goes to the type picker; job detail pages still live under
      // /admin/data/import/:jobId, so basePath stays the import root.
      backHref="/admin/data/import"
      basePath="/admin/data/import"
    />
  );
}
