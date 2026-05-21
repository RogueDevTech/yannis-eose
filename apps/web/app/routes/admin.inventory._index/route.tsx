import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  parsePerPage,
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
  ShipmentFilterOption,
  ShipmentRow,
  WarehouseRowLite,
  LowStockAlertsResult,
  LocationLowStockThreshold,
} from '~/features/inventory/types';
import { handleExportReportAction } from '~/lib/export-report.server';
import { InventoryOverviewLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

/** Read budget aligned with Remix single-fetch stream — see `api.server.ts`. */
const inventoryReadOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

export async function loader({ request }: LoaderFunctionArgs) {
  // HoCS gets inventory visibility by role so they can see stock when CS is
  // confirming orders. HEAD_OF_MARKETING was previously here too but was
  // removed by CEO directive — Marketing plans against ad-spend / funding,
  // not raw stock; Stock Manager and admins own inventory visibility.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
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
  // New explicit URL contract: ?sortBy=available|updatedAt and ?sortDir=asc|desc.
  // Legacy ?sort=lowestAvailable|highestAvailable still works (back-compat).
  const rawSortBy = url.searchParams.get('sortBy') ?? '';
  const rawSortDir = url.searchParams.get('sortDir') ?? '';
  const rawSearch = (url.searchParams.get('search') ?? '').trim();
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  // URL-driven page size — clamped to [20, 50, 100]; the `<Pagination>` per-page picker writes `perPage`.
  const { perPage: LEVELS_LIMIT } = parsePerPage(url.searchParams);

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
  // Prefer the new explicit params when present; fall back to the legacy fused enum.
  if (rawSortBy === 'available' || rawSortBy === 'updatedAt') {
    levelsInput.sortBy = rawSortBy;
  }
  if (rawSortDir === 'asc' || rawSortDir === 'desc') {
    levelsInput.sortOrder = rawSortDir;
  }
  if (!levelsInput.sortBy && !levelsInput.sortOrder) {
    if (rawSort === 'lowestAvailable') {
      levelsInput.sortBy = 'available';
      levelsInput.sortOrder = 'asc';
    } else if (rawSort === 'highestAvailable') {
      levelsInput.sortBy = 'available';
      levelsInput.sortOrder = 'desc';
    }
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
      totals?: { totalStock: number; totalReserved: number; totalDelivered: number };
      pagination: { total: number; totalPages: number };
    };
    movements: { movements: StockMovement[]; pagination: { total: number } };
    products: Array<{ id: string; name: string }>;
    warehouseLocations: Array<{
      id: string;
      name: string;
      providerName?: string | null;
      providerKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
    }>;
    displayLocations: Array<{
      id: string;
      name: string;
      providerName?: string | null;
      providerKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
    }>;
    systemSettings: Array<{ key: string; value: unknown }>;
    lowStockAlerts: LowStockAlertsResult;
    locationThresholds: {
      globalThreshold: number;
      locations: LocationLowStockThreshold[];
    };
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

  const products: ProductOption[] = (bundle?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const locations: LocationOption[] = (bundle?.warehouseLocations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
    providerKind: l.providerKind ?? null,
  }));
  const displayLocations: LocationOption[] = (bundle?.displayLocations ?? []).map(
    (l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
      providerKind: l.providerKind ?? null,
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

  const locationThresholds: LocationLowStockThreshold[] =
    bundle?.locationThresholds?.locations ?? [];

  const shipmentOptions: ShipmentFilterOption[] = (bundle?.shipments?.rows ?? []).map((shipment) => ({
    id: shipment.id,
    label:
      shipment.label != null && shipment.label.trim() !== ''
        ? `${shipment.referenceLabel} — ${shipment.label}`
        : shipment.referenceLabel,
  }));

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
    locationThresholds,
    warehouses,
  };

  return {
    levels: levelsData?.levels ?? [],
    levelsTotals: levelsData?.totals ?? { totalStock: 0, totalReserved: 0, totalDelivered: 0 },
    totalLevels: levelsData?.pagination?.total ?? 0,
    levelsPage: page,
    levelsTotalPages: levelsData?.pagination?.totalPages ?? 1,
    levelsLimit: LEVELS_LIMIT,
    levelsProductFilter: rawProductFilter,
    levelsLocationFilter: rawLocationFilter,
    levelsShipmentFilter: rawShipmentFilter,
    levelsSearch: rawSearch,
    levelsSort: rawSort === 'lowestAvailable' || rawSort === 'highestAvailable' ? rawSort : 'default',
    /** Resolved sort key sent to the API after legacy / new URL params are merged. */
    levelsSortBy: levelsInput.sortBy ?? 'updatedAt',
    /** Resolved sort direction sent to the API after legacy / new URL params are merged. */
    levelsSortDir: levelsInput.sortOrder ?? 'desc',
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
    canReadShipments:
      isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.shipments.read')),
    canAdjust:
      isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.adjust')),
    // Inventory CSV export is permission-gated via `inventory.export`. Admin-class
    // bypasses; STOCK_MANAGER and HoLogistics get it by default in the catalog.
    // Other roles can be granted ad-hoc via the user permission overrides UI.
    canExport: isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.export')),
    canEditLowStock: isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.lowStockAlerts')),
    canEditGlobalThreshold: isAdminLevel(user),
    lowStockThreshold: extras.lowStockThreshold,
    lowStockAlerts: Promise.resolve(extras.lowStockAlerts),
    locationThresholds: extras.locationThresholds,
    shipmentOptions,
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

  if (intent === 'updateLocationLowStockThreshold') {
    const locationId = formData.get('locationId')?.toString() ?? '';
    if (!locationId) {
      return json({ error: 'Missing location' }, { status: 400 });
    }
    // Empty / "inherit" clears the override and falls back to the org-wide threshold.
    const raw = (formData.get('lowStockThreshold')?.toString() ?? '').trim();
    let threshold: number | null = null;
    if (raw !== '' && raw.toLowerCase() !== 'inherit') {
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000) {
        return json({ error: 'Threshold must be between 1 and 10000' }, { status: 400 });
      }
      threshold = parsed;
    }
    const res = await apiRequest<unknown>('/trpc/inventory.setLocationLowStockThreshold', {
      method: 'POST',
      cookie,
      body: { locationId, threshold },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update location threshold') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, locationId, threshold });
  }

  // Bulk save: org-wide default + all changed per-location thresholds in one submit.
  if (intent === 'bulkSaveThresholds') {
    const errors: string[] = [];

    // 1. Org-wide default (always included).
    const globalRaw = formData.get('globalThreshold')?.toString() ?? '';
    const globalThreshold = parseInt(globalRaw, 10);
    if (Number.isFinite(globalThreshold) && globalThreshold >= 1 && globalThreshold <= 10000) {
      const res = await apiRequest<unknown>('/trpc/settings.updateSystemSetting', {
        method: 'POST',
        cookie,
        body: { key: 'INVENTORY_LOW_STOCK_CONFIG', value: { threshold: globalThreshold } },
      });
      if (!res.ok) {
        errors.push(extractApiErrorMessage(res.data, 'Failed to update org-wide threshold'));
      }
    }

    // 2. Per-location overrides — JSON array of { locationId, threshold }.
    const changesRaw = formData.get('locationChanges')?.toString() ?? '[]';
    let changes: Array<{ locationId: string; threshold: number | null }> = [];
    try { changes = JSON.parse(changesRaw); } catch { /* ignore */ }

    // Fan out in parallel — each is a separate tRPC call.
    const results = await Promise.allSettled(
      changes.map(({ locationId, threshold }) =>
        apiRequest<unknown>('/trpc/inventory.setLocationLowStockThreshold', {
          method: 'POST',
          cookie,
          body: { locationId, threshold },
        }),
      ),
    );
    const failCount = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
    ).length;
    if (failCount > 0) {
      errors.push(`${failCount} location threshold${failCount > 1 ? 's' : ''} failed to save`);
    }

    if (errors.length > 0) {
      return json({ error: errors.join('. ') }, { status: 500 });
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
