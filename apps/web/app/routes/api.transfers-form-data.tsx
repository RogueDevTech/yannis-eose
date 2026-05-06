import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
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

  const levelsInput = JSON.stringify({ limit: 100 });
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  try {
    const [productsRes, levelsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/products.list', opt),
      apiRequest<unknown>(`/trpc/inventory.levels?input=${encodeURIComponent(levelsInput)}`, opt),
    ]);

    const products = productsRes.ok
      ? ((productsRes.data as { result?: { data?: { products?: Product[] } } })?.result?.data?.products ?? [])
      : [];
    const levels = levelsRes.ok
      ? ((levelsRes.data as { result?: { data?: { levels?: InventoryLevel[] } } })?.result?.data?.levels ?? [])
      : [];

    return json({
      ok: productsRes.ok && levelsRes.ok,
      products,
      levels,
      error: productsRes.ok && levelsRes.ok ? null : 'Could not load transfer form data.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load transfer form data.';
    return json({ ok: false as const, products: [] as Product[], levels: [] as InventoryLevel[], error: msg });
  }
}

