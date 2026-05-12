import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { describeApiFetchFailure } from '~/lib/loader-api-fetch';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { InventoryPage } from '~/features/inventory/InventoryPage';
import { canonicalPermissionCode } from '~/lib/permission-codes';
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
import { TplInventoryLoadingShell } from '~/features/tpl/TplDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN', 'ADMIN'], permission: 'inventory.read' });
  const cookie = getSessionCookie(request);
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));

  const pageData = (async (): Promise<InventoryStreamData> => {
    const locationId = user.role === 'TPL_MANAGER' && user.logisticsLocationId ? user.logisticsLocationId : undefined;

    const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

    // Single bundled call — replaces 7 parallel tRPC HTTP round-trips
    // (levels + movements + products.options + locationOptions + transfers +
    // returnedOrders + reconciliations). Same fan-out runs server-side.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        ...(locationId && { locationId }),
        levelsPage: 1,
        levelsLimit: 100,
        movementsPage: 1,
        movementsLimit: 50,
      }),
    );
    const bundleRes = await apiRequest<unknown>(
      `/trpc/inventory.inventoryPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie, ...readOpts },
    );

    type BundleData = {
      levels: {
        levels: InventoryLevel[];
        totals?: { totalStock: number; totalReserved: number };
        pagination: { total: number };
      };
      movements: { movements: StockMovement[]; pagination: { total: number } };
      products: Array<{ id: string; name: string }>;
      locations: Array<{
        id: string;
        name: string;
        address?: string;
        dispatchLocked?: boolean;
        status: string;
        providerName?: string | null;
        providerKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
      }>;
      transfers: Transfer[];
      returnedOrders: ReturnedOrder[];
      reconciliations: Reconciliation[];
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    let levelsLoadError: string | null = null;
    let movementsLoadError: string | null = null;
    if (!bundleRes.ok) {
      levelsLoadError = describeApiFetchFailure('Stock levels', bundleRes);
      movementsLoadError = describeApiFetchFailure('Movement history', bundleRes);
    }

    const products: ProductOption[] = (bundle?.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
    }));

    const locationRows = bundle?.locations ?? [];
    const locations: LocationOption[] = locationRows.map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
      providerKind: l.providerKind ?? null,
    }));
    const locationsWithLock: LocationWithLock[] = locationRows.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address ?? '',
      dispatchLocked: l.dispatchLocked ?? false,
      status: l.status,
    }));

    return {
      levels: bundle?.levels?.levels ?? [],
      levelsTotals: bundle?.levels?.totals ?? { totalStock: 0, totalReserved: 0 },
      totalLevels: bundle?.levels?.pagination?.total ?? 0,
      movements: bundle?.movements?.movements ?? [],
      totalMovements: bundle?.movements?.pagination?.total ?? 0,
      products,
      locations,
      canIntake: false,
      canReadShipments:
        user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || actorPerms.has(canonicalPermissionCode('inventory.shipments.read')),
      transfers: bundle?.transfers ?? [],
      returnedOrders: bundle?.returnedOrders ?? [],
      reconciliations: bundle?.reconciliations ?? [],
      locationsWithLock,
      levelsLoadError,
      movementsLoadError,
    };
  })();

  return defer({ pageData });
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
  const { pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['stock:updated', 'transfer:created', 'order:status_changed']);
  return (
    <Suspense fallback={<TplInventoryLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => <InventoryPage {...data} />}
      </Await>
    </Suspense>
  );
}
