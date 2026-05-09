import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
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
  // Single bundled call — replaces 9 parallel tRPC HTTP round-trips
  // (levels + movements + products.options + 2× locationOptions +
  // settings.getSystemSettings + inventory.lowStockAlerts +
  // inventory.shipments.list + inventory.warehouses.list). Same fan-out
  // runs server-side via Promise.all.
  const bundleInput = encodeURIComponent(
    JSON.stringify({
      ...(rawProductFilter && { productId: rawProductFilter }),
      ...(rawLocationFilter && { locationId: rawLocationFilter }),
      ...(rawShipmentFilter && { shipmentId: rawShipmentFilter }),
      ...(rawSearch && { search: rawSearch }),
      ...(levelsInput.sortBy && { sortBy: levelsInput.sortBy }),
      ...(levelsInput.sortOrder && { sortOrder: levelsInput.sortOrder }),
      levelsPage: page,
      levelsLimit: LEVELS_LIMIT,
      shipmentsLimit: 100,
      warehousesLimit: 50,
    }),
  );
  const bundleRes = await apiRequest<unknown>(
    `/trpc/inventory.inventoryAdminPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie, ...inventoryReadOpts },
  );

  type BundleData = {
    levels: {
      levels: InventoryLevel[];
      totals?: { totalStock: number; totalReserved: number };
      pagination: { total: number; totalPages: number };
    };
    movements: { movements: StockMovement[]; pagination: { total: number } };
    products: { products: { id: string; name: string }[] };
    warehouseLocations: { locations: { id: string; name: string; providerName?: string | null }[] };
    displayLocations: { locations: { id: string; name: string; providerName?: string | null }[] };
    systemSettings: Array<{ key: string; value: unknown }>;
    lowStockAlerts: LowStockAlertsResult;
    shipments: { rows: ShipmentRow[]; pagination: { total: number } } | null;
    warehouses: {
      warehouses: Array<{
        id: string;
        name: string;
        address: string;
        dispatchLocked?: boolean;
        stockSummary?: { totalStock: number; totalReserved: number; skuCount: number };
      }>;
    } | null;
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

  const levelsData = bundle?.levels ?? null;
  const movementsRows = bundle?.movements?.movements ?? [];
  const movementsData = {
    movements: movementsRows,
    total: bundle?.movements?.pagination?.total ?? 0,
  };

  const deliveryOrderIds = Array.from(
    new Set(
      movementsData.movements
        .filter((m) => m.movementType === 'DELIVERY' && !!m.referenceId)
        .map((m) => m.referenceId as string),
    ),
  );

  // Customer name resolution remains a follow-up call because it depends on
  // movement IDs returned from the bundle. Skipped entirely when no DELIVERY
  // movements are present in this page slice.
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

  const products: ProductOption[] = (bundle?.products?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const locations: LocationOption[] = (bundle?.warehouseLocations?.locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
  }));
  const displayLocations: LocationOption[] = (bundle?.displayLocations?.locations ?? []).map(
    (l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
    }),
  );

  // Resolve low-stock threshold from system settings (same selector logic
  // as before, just sourced from the bundled payload).
  let lowStockThreshold = 10;
  const settingsRows = bundle?.systemSettings ?? [];
  const lowStockRow = settingsRows.find((s) => s.key === 'INVENTORY_LOW_STOCK_CONFIG');
  const threshold = (lowStockRow?.value as { threshold?: number } | null)?.threshold;
  if (typeof threshold === 'number' && threshold > 0) lowStockThreshold = threshold;

  const lowStockAlertsData: LowStockAlertsResult =
    bundle?.lowStockAlerts ?? { threshold: lowStockThreshold, items: [] };

  const shipments: ShipmentRow[] = bundle?.shipments?.rows ?? [];
  const totalShipments = bundle?.shipments?.pagination?.total ?? 0;

  const warehouses: WarehouseRowLite[] = (bundle?.warehouses?.warehouses ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    address: w.address,
    dispatchLocked: w.dispatchLocked ?? false,
    stockSummary: w.stockSummary ?? { totalStock: 0, totalReserved: 0, skuCount: 0 },
  }));

  const extras = {
    lowStockThreshold,
    lowStockAlerts: lowStockAlertsData,
    shipments,
    totalShipments,
    warehouses,
  };

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

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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
    <CachedAwait resolve={pageData} fallback={<InventoryOverviewLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => <InventoryPage {...(data as InventoryStreamData)} />}
    </CachedAwait>
  );
}
