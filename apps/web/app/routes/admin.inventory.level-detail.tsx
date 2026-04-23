import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import type { StockMovement } from '~/features/inventory/types';

export interface LevelBatch {
  id: string;
  factoryCost: string;
  landingCost: string;
  totalLandedCost: string;
  quantity: number;
  remainingQuantity: number;
  receivedAt: string;
}

export type LevelDetailData = {
  batches: LevelBatch[];
  movements: StockMovement[];
  total: number;
};

/**
 * Resource route for the Stock Levels detail drawer. Given a (productId, locationId),
 * returns both the FIFO batches that arrived at this location and the full movement
 * history affecting stock here. Backed by inventory.levelDetail which rescues legacy
 * rows that don't have location fields stamped (joins through orders).
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
    return json({ batches: [], movements: [], total: 0 } satisfies LevelDetailData, { status: 400 });
  }

  const input = { productId, locationId, limit: 200 };
  const res = await apiRequest<unknown>(
    `/trpc/inventory.levelDetail?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json({ batches: [], movements: [], total: 0 } satisfies LevelDetailData, { status: 200 });
  }

  const data = (res.data as {
    result?: { data?: { batches: LevelBatch[]; movements: StockMovement[]; total: number } };
  })?.result?.data;

  return json<LevelDetailData>({
    batches: data?.batches ?? [],
    movements: data?.movements ?? [],
    total: data?.total ?? 0,
  });
}
