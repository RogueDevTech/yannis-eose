import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
} from '~/lib/api.server';
import type { InventoryLevel, Product } from '~/features/transfers/types';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'transfers.read');
  const cookie = getSessionCookie(request);

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  try {
    // Use `levelsSummary` — aggregated (product × location) totals, no batch
    // rows, no pagination. The old `inventory.levels` endpoint paginates by
    // batch, so a warehouse with many FIFO shipments silently truncated and
    // the dropdown showed "0 units in stock".
    const [productsRes, levelsRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`, opt),
      apiRequest<unknown>('/trpc/inventory.levelsSummary', opt),
    ]);

    const products = productsRes.ok
      ? (((productsRes.data as { result?: { data?: Product[] } })?.result?.data ?? []) as Product[])
      : [];
    const levels = levelsRes.ok
      ? ((levelsRes.data as { result?: { data?: InventoryLevel[] } })?.result?.data ?? [])
      : [];

    const okBoth = productsRes.ok && levelsRes.ok;
    const payload = {
      ok: okBoth,
      products,
      levels,
      error: okBoth ? null : ('Could not load transfer form data.' as const),
    };
    return okBoth ? secondaryCacheJson(payload) : json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load transfer form data.';
    return json({ ok: false as const, products: [] as Product[], levels: [] as InventoryLevel[], error: msg });
  }
}
