import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { describeApiFetchFailure } from '~/lib/loader-api-fetch';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { InventoryPage } from '~/features/inventory/InventoryPage';
import type {
  InventoryLevel,
  StockMovement,
  InventoryStreamData,
  ProductOption,
  LocationOption,
  Transfer,
  ReturnedOrder,
  Reconciliation,
  LocationWithLock,
} from '~/features/inventory/types';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'inventory.read' });
  const cookie = getSessionCookie(request);

  const locationId = user.role === 'TPL_MANAGER' && user.logisticsLocationId ? user.logisticsLocationId : undefined;
  const levelsInput = locationId
    ? { locationId, page: 1, limit: 100 }
    : { page: 1, limit: 100 };
  const movementsInput = locationId
    ? { locationId, page: 1, limit: 50 }
    : { page: 1, limit: 50 };

  const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

  // Start all fetches concurrently
  const levelsPromise = apiRequest<unknown>(
    `/trpc/inventory.levels?input=${encodeURIComponent(JSON.stringify(levelsInput))}`,
    { method: 'GET', cookie, ...readOpts },
  );
  const movementsPromise = apiRequest<unknown>(
    `/trpc/inventory.movements?input=${encodeURIComponent(JSON.stringify(movementsInput))}`,
    { method: 'GET', cookie, ...readOpts },
  );
  const productsPromise = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ limit: 50, status: 'ACTIVE' }))}`,
    { method: 'GET', cookie, ...readOpts },
  );
  const locationsPromise = apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 20 }))}`,
    { method: 'GET', cookie, ...readOpts },
  );
  const transfersPromise = apiRequest<unknown>('/trpc/inventory.transfers', { method: 'GET', cookie, ...readOpts });
  const returnedPromise = apiRequest<unknown>('/trpc/inventory.returnedOrders', { method: 'GET', cookie, ...readOpts });
  const reconciliationsPromise = apiRequest<unknown>('/trpc/inventory.reconciliations', { method: 'GET', cookie, ...readOpts });

  // Await critical data
  const [levelsRes, movementsRes, productsRes, locationsRes, transfersRes, returnedRes] = await Promise.all([
    levelsPromise,
    movementsPromise,
    productsPromise,
    locationsPromise,
    transfersPromise,
    returnedPromise,
  ]);

  let levelsLoadError: string | null = null;
  let movementsLoadError: string | null = null;

  const levelsData = levelsRes.ok
    ? (levelsRes.data as {
        result?: {
          data?: {
            levels: InventoryLevel[];
            totals?: { totalStock: number; totalReserved: number };
            pagination: { total: number };
          };
        };
      })?.result?.data
    : null;
  if (!levelsRes.ok) {
    levelsLoadError = describeApiFetchFailure('Stock levels', levelsRes);
  }

  const movementsData = movementsRes.ok
    ? (movementsRes.data as { result?: { data?: { movements: StockMovement[]; pagination: { total: number } } } })?.result?.data
    : null;
  if (!movementsRes.ok) {
    movementsLoadError = describeApiFetchFailure('Movement history', movementsRes);
  }

  let products: ProductOption[] = [];
  if (productsRes.ok) {
    const data = (productsRes.data as { result?: { data?: { products: { id: string; name: string }[] } } })?.result?.data;
    products = (data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  let locations: LocationOption[] = [];
  let locationsWithLock: LocationWithLock[] = [];
  if (locationsRes.ok) {
    const data = (locationsRes.data as { result?: { data?: { locations: Array<{ id: string; name: string; address: string; dispatchLocked?: boolean; status: string; providerName?: string | null }> } } })?.result?.data;
    locations = (data?.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
    }));
    locationsWithLock = (data?.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address ?? '',
      dispatchLocked: l.dispatchLocked ?? false,
      status: l.status,
    }));
  }

  const transfersData = transfersRes.ok
    ? (transfersRes.data as { result?: { data?: Transfer[] } })?.result?.data ?? []
    : [];

  const returnedData = returnedRes.ok
    ? (returnedRes.data as { result?: { data?: ReturnedOrder[] } })?.result?.data ?? []
    : [];

  // Stream reconciliations
  const reconciliations = reconciliationsPromise.then((res) => {
    if (!res.ok) return [] as Reconciliation[];
    return (res.data as { result?: { data?: Reconciliation[] } })?.result?.data ?? [];
  }).catch(() => [] as Reconciliation[]);

  return {
    levels: levelsData?.levels ?? [],
    levelsTotals: levelsData?.totals ?? { totalStock: 0, totalReserved: 0 },
    totalLevels: levelsData?.pagination?.total ?? 0,
    movements: movementsData?.movements ?? [],
    totalMovements: movementsData?.pagination?.total ?? 0,
    products,
    locations,
    canIntake: false,
    transfers: transfersData,
    returnedOrders: returnedData,
    reconciliations,
    locationsWithLock,
    levelsLoadError,
    movementsLoadError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  // ── Returns actions ──
  if (intent === 'restock') {
    const orderId = formData.get('orderId')?.toString() ?? '';
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: { orderId, newStatus: 'RESTOCKED', metadata: {} },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to restock') }, { status: safeStatus(res.status) });
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
      body: { orderId, newStatus: 'WRITTEN_OFF', metadata: { reason } },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to write off') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  // ── Reconciliation actions ──
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create reconciliation') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplInventoryRoute() {
  const data = useLoaderData<typeof loader>() as InventoryStreamData;
  usePageRefreshOnEvent(['stock:updated', 'transfer:created', 'order:status_changed']);
  return (
    <>
      <InventoryPage {...data} />
    </>
  );
}
