import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { describeApiFetchFailure } from '~/lib/loader-api-fetch';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { InventoryPage } from '~/features/inventory/InventoryPage';
import type {
  InventoryLevel,
  StockMovement,
  InventoryStreamData,
  ProductOption,
  LocationOption,
  ShipmentRow,
  WarehouseRowLite,
  LowStockAlertsResult,
} from '~/features/inventory/types';
import { handleExportReportAction } from '~/lib/export-report.server';
import { InventoryOverviewLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

/** Read budget aligned with Remix single-fetch stream — see `api.server.ts`. */
const inventoryReadOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

export async function loader({ request }: LoaderFunctionArgs) {
  // Heads (HoM, HoCS) get inventory visibility by role so they can see stock levels
  // when planning campaigns / CS priorities, even without the inventory.read permission.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });
  const cookie = getSessionCookie(request);
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));

  // Parse Stock-Levels filter + sort + pagination from URL search params.
  // `sort=lowestAvailable|highestAvailable` maps to backend sortBy/sortOrder pairs.
  const url = new URL(request.url);
  const rawProductFilter = url.searchParams.get('productId') ?? '';
  const rawLocationFilter = url.searchParams.get('locationId') ?? '';
  const rawShipmentFilter = url.searchParams.get('shipmentId') ?? '';
  const rawSort = url.searchParams.get('sort') ?? '';
  const rawSearch = (url.searchParams.get('search') ?? '').trim();
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const LEVELS_LIMIT = 20;

  const levelsInput: {
    productId?: string;
    locationId?: string;
    shipmentId?: string;
    search?: string;
    sortBy?: 'available' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
  } = { page, limit: LEVELS_LIMIT };
  if (rawProductFilter) levelsInput.productId = rawProductFilter;
  if (rawLocationFilter) levelsInput.locationId = rawLocationFilter;
  if (rawShipmentFilter) levelsInput.shipmentId = rawShipmentFilter;
  if (rawSearch) levelsInput.search = rawSearch;
  if (rawSort === 'lowestAvailable') {
    levelsInput.sortBy = 'available';
    levelsInput.sortOrder = 'asc';
  } else if (rawSort === 'highestAvailable') {
    levelsInput.sortBy = 'available';
    levelsInput.sortOrder = 'desc';
  }

  const pageData = (async () => {
  // Start fetches concurrently (extended read timeout — inventory fans out many calls under single-fetch).
  const levelsPromise = apiRequest<unknown>(
    `/trpc/inventory.levels?input=${encodeURIComponent(JSON.stringify(levelsInput))}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );
  const movementsPromise = apiRequest<unknown>('/trpc/inventory.movements', {
    method: 'GET',
    cookie,
    ...inventoryReadOpts,
  });
  const productsPromise = apiRequest<unknown>(
    `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );
  // Stock intake / inbound shipment targets: company-owned warehouses (provider kind
  // WAREHOUSE), not 3PL partner locations. Dropdowns list sites managed at
  // /admin/inventory/warehouses.
  const locationsPromise = apiRequest<unknown>(
    `/trpc/logistics.locationOptions?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', providerKind: 'WAREHOUSE' }))}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );
  /** Resolve labels on stock rows (includes non-warehouse sites — avoids “Unknown location” on 3PL shelves). */
  const displayLocationsPromise = apiRequest<unknown>(
    `/trpc/logistics.locationOptions?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );
  const lowStockPromise = apiRequest<unknown>(
    '/trpc/settings.getSystemSettings',
    { method: 'GET', cookie, ...inventoryReadOpts },
  );
  const lowStockAlertsPromise = apiRequest<unknown>(
    '/trpc/inventory.lowStockAlerts',
    { method: 'GET', cookie, ...inventoryReadOpts },
  );

  // Inbound shipments — list page 1 of 20 most recent for the user's scope.
  // Service auto-scopes by `currentBranchId` for non-admins via the destination location.
  const shipmentsInput = { page: 1, limit: 100 };
  const shipmentsPromise = apiRequest<unknown>(
    `/trpc/inventory.shipments.list?input=${encodeURIComponent(JSON.stringify(shipmentsInput))}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );

  // Inhouse warehouses — show on the inventory page so warehouse-held stock isn't hidden.
  const warehousesPromise = apiRequest<unknown>(
    `/trpc/inventory.warehouses.list?input=${encodeURIComponent(
      JSON.stringify({ status: 'ACTIVE', listScope: 'our', page: 1, limit: 50 }),
    )}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );

  // Await levels (critical for stats)
  const levelsRes = await levelsPromise;

  let levelsLoadError: string | null = null;
  const levelsData = levelsRes.ok
    ? (levelsRes.data as {
        result?: {
          data?: {
            levels: InventoryLevel[];
            totals?: { totalStock: number; totalReserved: number };
            pagination: { total: number; totalPages: number };
          };
        };
      })?.result?.data
    : null;

  if (!levelsRes.ok) {
    levelsLoadError = describeApiFetchFailure('Stock levels', levelsRes);
  }

  // Await movements data
  let movementsLoadError: string | null = null;
  const movementsData = await movementsPromise.then((movementsRes) => {
    if (!movementsRes.ok) {
      movementsLoadError = describeApiFetchFailure('Movement history', movementsRes);
      return { movements: [] as StockMovement[], total: 0 };
    }
    const data = (movementsRes.data as { result?: { data?: { movements: StockMovement[]; pagination: { total: number } } } })?.result?.data;
    return { movements: data?.movements ?? [], total: data?.pagination?.total ?? 0 };
  }).catch(() => {
    movementsLoadError = 'Movement history could not be loaded. Try Reload data.';
    return { movements: [] as StockMovement[], total: 0 };
  });

  const deliveryOrderIds = Array.from(
    new Set(
      movementsData.movements
        .filter((m) => m.movementType === 'DELIVERY' && !!m.referenceId)
        .map((m) => m.referenceId as string),
    ),
  );

  const deliveryOrderCustomerNameById = new Map<string, string>();
  if (deliveryOrderIds.length > 0) {
    const batchRes = await apiRequest<{
      result?: { data?: Array<{ orderId: string; customerName: string }> };
    }>(
      `/trpc/orders.deliveryMovementCustomerNames?input=${encodeURIComponent(
        JSON.stringify({ orderIds: deliveryOrderIds }),
      )}`,
      { method: 'GET', cookie, ...inventoryReadOpts },
    );
    const batchRows = batchRes.ok
      ? ((batchRes.data as { result?: { data?: Array<{ orderId: string; customerName: string }> } })?.result?.data ?? [])
      : [];
    for (const row of batchRows) {
      deliveryOrderCustomerNameById.set(row.orderId, row.customerName);
    }
  }

  // Products and locations for Receive Shipment (Shipments tab)
  const [productsRes, locationsRes, displayLocationsRes] = await Promise.all([
    productsPromise,
    locationsPromise,
    displayLocationsPromise,
  ]);

  let products: ProductOption[] = [];
  if (productsRes.ok) {
    const data = (productsRes.data as { result?: { data?: { products: { id: string; name: string }[] } } })?.result?.data;
    products = (data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  let locations: LocationOption[] = [];
  if (locationsRes.ok) {
    const data = (locationsRes.data as {
      result?: { data?: { locations: { id: string; name: string; providerName?: string | null }[] } };
    })?.result?.data;
    locations = (data?.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
    }));
  }

  let displayLocations: LocationOption[] = [];
  if (displayLocationsRes.ok) {
    const data = (displayLocationsRes.data as {
      result?: { data?: { locations: { id: string; name: string; providerName?: string | null }[] } };
    })?.result?.data;
    displayLocations = (data?.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
    }));
  }

  /** Threshold, low-stock banner, shipments strip, warehouses — resolved before first paint of page body. */
  const extras = await Promise.all([
    lowStockPromise.catch(() => null),
    lowStockAlertsPromise.catch(() => ({ ok: false as const, status: 503, data: {} })),
    shipmentsPromise.catch(() => null),
    warehousesPromise.catch(() => null),
  ]).then(([lowStockRes, alertsRes, shipmentsRes, warehousesRes]) => {
    let lowStockThreshold = 10;
    if (lowStockRes?.ok) {
      const settingsRows =
        (lowStockRes.data as { result?: { data?: { key: string; value: unknown }[] } })?.result?.data ?? [];
      const row = settingsRows.find((s) => s.key === 'INVENTORY_LOW_STOCK_CONFIG');
      const threshold = (row?.value as { threshold?: number } | null)?.threshold;
      if (typeof threshold === 'number' && threshold > 0) lowStockThreshold = threshold;
    }

    let lowStockAlertsData: LowStockAlertsResult;
    if (!alertsRes.ok) {
      lowStockAlertsData = { threshold: lowStockThreshold, items: [] };
    } else {
      const data = (alertsRes.data as {
        result?: { data?: LowStockAlertsResult };
      })?.result?.data;
      lowStockAlertsData = data ?? { threshold: lowStockThreshold, items: [] };
    }

    let shipments: ShipmentRow[] = [];
    let totalShipments = 0;
    if (shipmentsRes?.ok) {
      const data = (shipmentsRes.data as {
        result?: { data?: { rows: ShipmentRow[]; pagination: { total: number } } };
      })?.result?.data;
      shipments = data?.rows ?? [];
      totalShipments = data?.pagination?.total ?? 0;
    }

    let warehouses: WarehouseRowLite[] = [];
    if (warehousesRes?.ok) {
      const data = (warehousesRes.data as {
        result?: {
          data?: {
            warehouses: Array<{
              id: string;
              name: string;
              address: string;
              dispatchLocked?: boolean;
              stockSummary?: { totalStock: number; totalReserved: number; skuCount: number };
            }>;
          };
        };
      })?.result?.data;
      warehouses = (data?.warehouses ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        address: w.address,
        dispatchLocked: w.dispatchLocked ?? false,
        stockSummary: w.stockSummary ?? { totalStock: 0, totalReserved: 0, skuCount: 0 },
      }));
    }

    return {
      lowStockThreshold,
      lowStockAlerts: lowStockAlertsData,
      shipments,
      totalShipments,
      warehouses,
    };
  });

  return {
    levels: levelsData?.levels ?? [],
    levelsTotals: levelsData?.totals ?? { totalStock: 0, totalReserved: 0 },
    totalLevels: levelsData?.pagination?.total ?? 0,
    levelsPage: page,
    levelsTotalPages: levelsData?.pagination?.totalPages ?? 1,
    levelsLimit: LEVELS_LIMIT,
    levelsProductFilter: rawProductFilter,
    levelsLocationFilter: rawLocationFilter,
    levelsShipmentFilter: rawShipmentFilter,
    levelsSearch: rawSearch,
    levelsSort: rawSort === 'lowestAvailable' || rawSort === 'highestAvailable' ? rawSort : 'default',
    movements: movementsData.movements.map((m) => ({
      ...m,
      referenceCustomerName: m.referenceId ? deliveryOrderCustomerNameById.get(m.referenceId) ?? null : null,
    })),
    totalMovements: movementsData.total,
    products,
    locations,
    displayLocations,
    // Receive shipment (same gate as legacy intake); single-product intake UI removed — receipts go through shipments.
    canIntake:
      isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.intake')),
    canAdjust:
      isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.adjust')),
    // Inventory CSV export is permission-gated via `inventory.export`. Admin-class
    // bypasses; STOCK_MANAGER and HoLogistics get it by default in the catalog.
    // Other roles can be granted ad-hoc via the user permission overrides UI.
    canExport: isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.export')),
    canEditLowStock: isAdminLevel(user),
    lowStockThreshold: extras.lowStockThreshold,
    lowStockAlerts: Promise.resolve(extras.lowStockAlerts),
    shipments: extras.shipments,
    totalShipments: extras.totalShipments,
    warehouses: extras.warehouses,
    levelsLoadError,
    movementsLoadError,
  };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'adjustStock') {
    await requirePermission(request, 'inventory.adjust');
    const productId = formData.get('productId')?.toString() ?? '';
    const locationId = formData.get('locationId')?.toString() ?? '';
    const adjustmentQuantity = parseInt(formData.get('adjustmentQuantity')?.toString() ?? '0', 10);
    const reason = formData.get('reason')?.toString().trim() ?? '';

    if (!productId || !locationId || !Number.isFinite(adjustmentQuantity) || adjustmentQuantity === 0) {
      return json({ error: 'Product, location, and a non-zero adjustment quantity are required' }, { status: 400 });
    }
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.adjust', {
      method: 'POST',
      cookie,
      body: { productId, locationId, adjustmentQuantity, reason },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to adjust stock') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'createShipment') {
    await requirePermission(request, 'inventory.intake');
    const destinationLocationId = formData.get('destinationLocationId')?.toString() ?? '';
    const label = formData.get('label')?.toString() ?? '';
    const supplierName = formData.get('supplierName')?.toString() ?? '';
    const supplierReference = formData.get('supplierReference')?.toString() ?? '';
    const expectedArrivalDate = formData.get('expectedArrivalDate')?.toString() ?? '';
    const totalLandingCost = formData.get('totalLandingCost')?.toString() ?? '0';
    const notes = formData.get('notes')?.toString() ?? '';
    const arrivedNow = formData.get('arrivedNow')?.toString() === 'true';
    const linesRaw = formData.get('lines')?.toString() ?? '[]';

    let lines: Array<{ productId: string; expectedQuantity: number; factoryCost: number }>;
    try {
      const parsed = JSON.parse(linesRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return json({ error: 'Add at least one line item to the shipment.' }, { status: 400 });
      }
      lines = parsed;
    } catch {
      return json({ error: 'Invalid shipment line payload.' }, { status: 400 });
    }
    if (!destinationLocationId) {
      return json({ error: 'Destination location is required.' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.shipments.create', {
      method: 'POST',
      cookie,
      body: {
        destinationLocationId,
        label,
        supplierName,
        supplierReference,
        expectedArrivalDate,
        totalLandingCost: Number(totalLandingCost) || 0,
        notes,
        arrivedNow,
        lines,
      },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create shipment') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'shipmentMarkInTransit' || intent === 'shipmentMarkArrived') {
    await requirePermission(request, 'inventory.intake');
    const shipmentId = formData.get('shipmentId')?.toString() ?? '';
    if (!shipmentId) return json({ error: 'Missing shipment id.' }, { status: 400 });
    const procedure =
      intent === 'shipmentMarkInTransit'
        ? 'inventory.shipments.markInTransit'
        : 'inventory.shipments.markArrived';
    const res = await apiRequest<unknown>(`/trpc/${procedure}`, {
      method: 'POST',
      cookie,
      body: { shipmentId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update shipment') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'shipmentCancel') {
    await requirePermission(request, 'inventory.intake');
    const shipmentId = formData.get('shipmentId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!shipmentId) return json({ error: 'Missing shipment id.' }, { status: 400 });
    if (reason.length < 10) return json({ error: 'Reason must be at least 10 characters.' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/inventory.shipments.cancel', {
      method: 'POST',
      cookie,
      body: { shipmentId, reason },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to cancel shipment') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateLowStockThreshold') {
    const raw = formData.get('lowStockThreshold')?.toString() ?? '';
    const threshold = parseInt(raw, 10);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 10000) {
      return json({ error: 'Threshold must be between 1 and 10000' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
      method: 'POST',
      cookie,
      body: { key: 'INVENTORY_LOW_STOCK_CONFIG', value: { threshold } },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update threshold') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function InventoryIndexRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['stock:updated', 'transfer:created']);
  return (
    <Suspense fallback={<InventoryOverviewLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => <InventoryPage {...(data as InventoryStreamData)} />}
      </Await>
    </Suspense>
  );
}
