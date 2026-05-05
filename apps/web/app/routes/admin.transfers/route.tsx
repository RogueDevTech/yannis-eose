import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
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
  // The transfer form looks up available stock by `(productId, locationId)` against
  // this list. Without an explicit `limit`, the API defaults to 20 rows — so any
  // level past row 20 silently returns 0 and the form shows "Quantity (max: 0)"
  // even when stock is plenty. Pull up to the schema cap (100) so a typical
  // multi-product / multi-location org has every row available client-side.
  const levelsInput = JSON.stringify({ limit: 100 });
  const levelsPromise = apiRequest<unknown>(
    `/trpc/inventory.levels?input=${encodeURIComponent(levelsInput)}`,
    { method: 'GET', cookie },
  );

  // Await only critical: transfers, locations
  const [transfersRes, locationsRes] = await Promise.all([transfersPromise, locationsPromise]);

  const transfersData = transfersRes.ok
    ? (transfersRes.data as { result?: { data?: Transfer[] } })?.result?.data
    : null;

  const locationsRaw = locationsRes.ok
    ? (locationsRes.data as {
        result?: { data?: { locations: { id: string; providerId: string; name: string; address: string; status: string; providerName?: string | null }[] } };
      })?.result?.data?.locations ?? []
    : [];
  const locationsData = {
    locations: locationsRaw.map((l) => ({
      id: l.id,
      providerId: l.providerId,
      name: l.name,
      address: l.address,
      status: l.status,
      providerName: l.providerName ?? null,
    })) as Location[],
  };

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
    locations: locationsData.locations,
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to initiate transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'cancelTransfer') {
    const transferId = formData.get('transferId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!transferId) {
      return json({ error: 'Transfer ID is required' }, { status: 400 });
    }
    if (reason.length < 10) {
      return json({ error: 'Cancellation reason must be at least 10 characters' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.cancelTransfer', {
      method: 'POST',
      cookie,
      body: { transferId, reason },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to cancel transfer') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TransfersRoute() {
  const data = useLoaderData<typeof loader>() as TransfersStreamData;
  return (
    <>
      <TransfersPage {...data} />
    </>
  );
}
