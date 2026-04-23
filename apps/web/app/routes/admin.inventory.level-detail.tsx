import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import type { StockMovement } from '~/features/inventory/types';

export type LevelDetailData = {
  movements: StockMovement[];
  total: number;
};

/**
 * Resource route for the Stock Levels detail drawer. Given a (productId, locationId),
 * returns the movement history for that inventory row.
 *
 * Access mirrors the inventory page itself: admin-level + HoM/HoCS can view; anyone
 * with inventory.read can also view. No write operations happen here.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  const locationId = url.searchParams.get('locationId');

  if (!productId || !locationId) {
    return json({ movements: [] as StockMovement[], total: 0 } satisfies LevelDetailData, { status: 400 });
  }

  const input = { productId, locationId, page: 1, limit: 100 };
  const res = await apiRequest<unknown>(
    `/trpc/inventory.movements?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json({ movements: [] as StockMovement[], total: 0 } satisfies LevelDetailData, { status: 200 });
  }

  const data = (res.data as {
    result?: { data?: { movements: StockMovement[]; pagination: { total: number } } };
  })?.result?.data;

  return json<LevelDetailData>({
    movements: data?.movements ?? [],
    total: data?.pagination?.total ?? 0,
  });
}
