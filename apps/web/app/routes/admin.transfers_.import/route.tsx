import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { TransfersImportPage } from '~/features/transfers/TransfersImportPage';
import type { Location, Product } from '~/features/transfers/types';

export const meta: MetaFunction = () => [
  { title: 'Bulk import transfers — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.transfer');
  const cookie = getSessionCookie(request);

  const [locationsRes, productsRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const locations: Location[] = (
    locationsRes.ok
      ? ((locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data?.locations ?? [])
      : []
  ).map((l) => ({
    id: l.id,
    providerId: l.providerId,
    name: l.name,
    address: l.address,
    status: l.status,
    providerName: (l as { providerName?: string | null }).providerName ?? null,
  }));

  const products: Product[] = productsRes.ok
    ? ((productsRes.data as { result?: { data?: Product[] } })?.result?.data ?? [])
    : [];

  return json({ locations, products });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'importTransferBatch') {
    const fromLocationId = formData.get('fromLocationId')?.toString() ?? '';
    const toLocationId = formData.get('toLocationId')?.toString() ?? '';
    let lines: Array<{ productId: string; quantity: number }>;
    try {
      const raw = JSON.parse(formData.get('lines')?.toString() ?? '[]') as unknown;
      if (!Array.isArray(raw)) throw new Error('lines is not an array');
      lines = raw
        .map((l) => {
          const o = (l ?? {}) as { productId?: unknown; quantity?: unknown };
          return { productId: String(o.productId ?? ''), quantity: Number(o.quantity ?? 0) };
        })
        .filter((l) => l.productId && l.quantity > 0);
    } catch {
      return json({ error: 'Invalid transfer lines payload' }, { status: 400 });
    }

    if (!fromLocationId || !toLocationId) {
      return json({ error: 'Source and destination locations are required' }, { status: 400 });
    }
    if (lines.length === 0) {
      return json({ error: 'No valid product lines to transfer' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.transferBatch', {
      method: 'POST',
      cookie,
      body: { fromLocationId, toLocationId, lines },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to initiate transfer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TransfersImportRoute() {
  const { locations, products } = useLoaderData<typeof loader>();
  return <TransfersImportPage locations={locations} products={products} />;
}
