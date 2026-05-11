import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';

/**
 * Category picklist for the Products → Import products modal. The modal opens
 * lazily, so this resource route is only fetched on demand. ACTIVE categories
 * only — archived / inactive ones shouldn't be a valid target for new product
 * rows. The import resolver matches sheet cells against `name` (case-insensitive),
 * so we surface that field plus the id back to the client.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  // Same gate as the page action — only operators who can create products
  // ever open the modal.
  await requirePermission(request, 'products.create');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/productCategories.listActive', {
    method: 'GET',
    cookie,
  });
  if (!res.ok) {
    return json({ categories: [] as Array<{ id: string; name: string }> });
  }
  const data = res.data as {
    result?: { data?: Array<{ id: string; name: string; status?: string }> };
  };
  const all = data?.result?.data ?? [];
  return json({
    categories: all.map((c) => ({ id: c.id, name: c.name })),
  });
}
