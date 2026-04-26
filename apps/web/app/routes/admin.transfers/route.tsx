import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from '~/features/transfers/types';

export const meta: MetaFunction = () => [
  { title: 'Stock Transfers — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'transfers.read');
  const cookie = getSessionCookie(request);

  // Start all 4 fetches concurrently
  const transfersPromise = apiRequest<unknown>('/trpc/inventory.transfers', { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>('/trpc/logistics.listLocations', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });
  const levelsPromise = apiRequest<unknown>('/trpc/inventory.levels', { method: 'GET', cookie });

  // Await only critical: transfers, locations
  const [transfersRes, locationsRes] = await Promise.all([transfersPromise, locationsPromise]);

  const transfersData = transfersRes.ok
    ? (transfersRes.data as { result?: { data?: Transfer[] } })?.result?.data
    : null;

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
    : null;

  // Return products, levels as un-awaited promises with .catch() fallback
  const products = productsPromise.then((res) => {
    if (!res.ok) return [] as Product[];
    return (res.data as { result?: { data?: { products: Product[] } } })?.result?.data?.products ?? [];
  }).catch(() => [] as Product[]);

  const levels = levelsPromise.then((res) => {
    if (!res.ok) return [] as InventoryLevel[];
    return (res.data as { result?: { data?: { levels: InventoryLevel[] } } })?.result?.data?.levels ?? [];
  }).catch(() => [] as InventoryLevel[]);

  return {
    transfers: transfersData ?? [],
    locations: locationsData?.locations ?? [],
    products,
    levels,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'initiateTransfer') {
    const quantity = parseInt(formData.get('quantity')?.toString() ?? '0', 10);
    if (quantity <= 0) {
      return json({ error: 'Quantity must be at least 1' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.transfer', {
      method: 'POST',
      cookie,
      body: {
        productId: formData.get('productId')?.toString() ?? '',
        fromLocationId: formData.get('fromLocationId')?.toString() ?? '',
        toLocationId: formData.get('toLocationId')?.toString() ?? '',
        quantity,
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to initiate transfer' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TransfersRoute() {
  const data = useLoaderData<typeof loader>() as TransfersStreamData;
  return <TransfersPage {...data} />;
}
