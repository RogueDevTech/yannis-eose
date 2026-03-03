import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { ReturnsPage } from '~/features/returns/ReturnsPage';
import type {
  ReturnedOrder,
  Location,
  Reconciliation,
  Product,
  InventoryLevel,
  ReturnsStreamData,
} from '~/features/returns/types';

export const meta: MetaFunction = () => [
  { title: 'Returns & Restock — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'returns.read');
  const cookie = getSessionCookie(request);

  // Start all 5 fetches concurrently
  const returnedPromise = apiRequest<unknown>('/trpc/inventory.returnedOrders', { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>('/trpc/logistics.listLocations', { method: 'GET', cookie });
  const reconciliationsPromise = apiRequest<unknown>('/trpc/inventory.reconciliations', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });
  const levelsPromise = apiRequest<unknown>('/trpc/inventory.levels', { method: 'GET', cookie });

  // Await only critical: returnedOrders, locations
  const [returnedRes, locationsRes] = await Promise.all([returnedPromise, locationsPromise]);

  const returnedData = returnedRes.ok
    ? (returnedRes.data as { result?: { data?: ReturnedOrder[] } })?.result?.data
    : null;

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
    : null;

  // Return reconciliations, products, levels as un-awaited promises with .catch() fallback
  const reconciliations = reconciliationsPromise.then((res) => {
    if (!res.ok) return [] as Reconciliation[];
    return (res.data as { result?: { data?: Reconciliation[] } })?.result?.data ?? [];
  }).catch(() => [] as Reconciliation[]);

  const products = productsPromise.then((res) => {
    if (!res.ok) return [] as Product[];
    return (res.data as { result?: { data?: { products: Product[] } } })?.result?.data?.products ?? [];
  }).catch(() => [] as Product[]);

  const levels = levelsPromise.then((res) => {
    if (!res.ok) return [] as InventoryLevel[];
    return (res.data as { result?: { data?: { levels: InventoryLevel[] } } })?.result?.data?.levels ?? [];
  }).catch(() => [] as InventoryLevel[]);

  return {
    returnedOrders: returnedData ?? [],
    locations: locationsData?.locations ?? [],
    reconciliations,
    products,
    levels,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'restock') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus: 'RESTOCKED',
        metadata: {},
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to restock' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'writeOff') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() ?? '';
    if (reason.length < 10) {
      return json({ error: 'Damage note must be at least 10 characters' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus: 'WRITTEN_OFF',
        metadata: { reason },
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to write off' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'createReconciliation') {
    const physicalCount = parseInt(formData.get('physicalCount')?.toString() ?? '0', 10);
    const res = await apiRequest<unknown>('/trpc/inventory.createReconciliation', {
      method: 'POST',
      cookie,
      body: {
        locationId: formData.get('locationId')?.toString() ?? '',
        productId: formData.get('productId')?.toString() ?? '',
        physicalCount,
        reasonCode: formData.get('reasonCode')?.toString() ?? 'OTHER',
        notes: formData.get('notes')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create reconciliation' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'resolveReconciliation') {
    const approved = formData.get('approved')?.toString() === 'true';
    const res = await apiRequest<unknown>('/trpc/inventory.resolveReconciliation', {
      method: 'POST',
      cookie,
      body: {
        reconciliationId: formData.get('reconciliationId')?.toString() ?? '',
        approved,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to resolve reconciliation' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function ReturnsRoute() {
  const data = useLoaderData<typeof loader>() as ReturnsStreamData;
  return <ReturnsPage {...data} />;
}
