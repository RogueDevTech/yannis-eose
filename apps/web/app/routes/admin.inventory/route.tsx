import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { InventoryPage } from '~/features/inventory/InventoryPage';
import type { InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption } from '~/features/inventory/types';
import { handleExportReportAction } from '~/lib/export-report.server';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Heads (HoM, HoCS) get inventory visibility by role so they can see stock levels
  // when planning campaigns / CS priorities, even without the inventory.read permission.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });
  const cookie = getSessionCookie(request);

  // Parse Stock-Levels filter + sort + pagination from URL search params.
  // `sort=lowestAvailable|highestAvailable` maps to backend sortBy/sortOrder pairs.
  const url = new URL(request.url);
  const rawProductFilter = url.searchParams.get('productId') ?? '';
  const rawLocationFilter = url.searchParams.get('locationId') ?? '';
  const rawSort = url.searchParams.get('sort') ?? '';
  const rawSearch = (url.searchParams.get('search') ?? '').trim();
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const LEVELS_LIMIT = 20;

  const levelsInput: {
    productId?: string;
    locationId?: string;
    search?: string;
    sortBy?: 'available' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
  } = { page, limit: LEVELS_LIMIT };
  if (rawProductFilter) levelsInput.productId = rawProductFilter;
  if (rawLocationFilter) levelsInput.locationId = rawLocationFilter;
  if (rawSearch) levelsInput.search = rawSearch;
  if (rawSort === 'lowestAvailable') {
    levelsInput.sortBy = 'available';
    levelsInput.sortOrder = 'asc';
  } else if (rawSort === 'highestAvailable') {
    levelsInput.sortBy = 'available';
    levelsInput.sortOrder = 'desc';
  }

  // Start fetches concurrently
  const levelsPromise = apiRequest<unknown>(
    `/trpc/inventory.levels?input=${encodeURIComponent(JSON.stringify(levelsInput))}`,
    { method: 'GET', cookie },
  );
  const movementsPromise = apiRequest<unknown>('/trpc/inventory.movements', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>(`/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ limit: 20, status: 'ACTIVE' }))}`, { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 100 }))}`,
    { method: 'GET', cookie },
  );
  const lowStockPromise = apiRequest<unknown>(
    '/trpc/settings.getSystemSettings',
    { method: 'GET', cookie },
  );
  const lowStockAlertsPromise = apiRequest<unknown>(
    '/trpc/inventory.lowStockAlerts',
    { method: 'GET', cookie },
  );

  // Await levels (critical for stats)
  const levelsRes = await levelsPromise;

  const levelsData = levelsRes.ok
    ? (levelsRes.data as { result?: { data?: { levels: InventoryLevel[]; pagination: { total: number; totalPages: number } } } })?.result?.data
    : null;

  // Await movements data
  const movementsData = await movementsPromise.then((movementsRes) => {
    if (!movementsRes.ok) return { movements: [] as StockMovement[], total: 0 };
    const data = (movementsRes.data as { result?: { data?: { movements: StockMovement[]; pagination: { total: number } } } })?.result?.data;
    return { movements: data?.movements ?? [], total: data?.pagination?.total ?? 0 };
  }).catch(() => ({ movements: [] as StockMovement[], total: 0 }));

  // Products and locations for Stock Intake
  const [productsRes, locationsRes] = await Promise.all([productsPromise, locationsPromise]);

  let products: ProductOption[] = [];
  if (productsRes.ok) {
    const data = (productsRes.data as { result?: { data?: { products: { id: string; name: string }[] } } })?.result?.data;
    products = (data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  let locations: LocationOption[] = [];
  if (locationsRes.ok) {
    const data = (locationsRes.data as { result?: { data?: { locations: { id: string; name: string }[] } } })?.result?.data;
    locations = (data?.locations ?? []).map((l) => ({ id: l.id, name: l.name }));
  }

  // Low-stock alert threshold (org-wide setting). Default 10 if unset.
  let lowStockThreshold = 10;
  const lowStockRes = await lowStockPromise.catch(() => null);
  if (lowStockRes?.ok) {
    const settingsRows = (lowStockRes.data as { result?: { data?: { key: string; value: unknown }[] } })?.result?.data ?? [];
    const row = settingsRows.find((s) => s.key === 'INVENTORY_LOW_STOCK_CONFIG');
    const threshold = (row?.value as { threshold?: number } | null)?.threshold;
    if (typeof threshold === 'number' && threshold > 0) lowStockThreshold = threshold;
  }

  // Stream low-stock alerts as a deferred promise — silently empty if no permission.
  const lowStockAlerts = lowStockAlertsPromise.then((res) => {
    if (!res.ok) return { threshold: lowStockThreshold, items: [] };
    const data = (res.data as { result?: { data?: { threshold: number; items: unknown[] } } })?.result?.data;
    return data ?? { threshold: lowStockThreshold, items: [] };
  }).catch(() => ({ threshold: lowStockThreshold, items: [] as unknown[] }));

  return {
    levels: levelsData?.levels ?? [],
    totalLevels: levelsData?.pagination?.total ?? 0,
    levelsPage: page,
    levelsTotalPages: levelsData?.pagination?.totalPages ?? 1,
    levelsLimit: LEVELS_LIMIT,
    levelsProductFilter: rawProductFilter,
    levelsLocationFilter: rawLocationFilter,
    levelsSearch: rawSearch,
    levelsSort: rawSort === 'lowestAvailable' || rawSort === 'highestAvailable' ? rawSort : 'default',
    movements: movementsData.movements,
    totalMovements: movementsData.total,
    products,
    locations,
    // Admin-level users bypass permission lookups at the middleware layer (permissions: []),
    // so we must also bypass here — otherwise the Stock Intake button is hidden from SuperAdmin / Admin.
    canIntake: isAdminLevel(user) || (user.permissions?.includes('inventory.intake') ?? false),
    canAdjust: isAdminLevel(user) || (user.permissions?.includes('inventory.adjust') ?? false),
    // Inventory CSV export is restricted to admin-level users and STOCK_MANAGER — the same
    // roles that own the stock data. Everyone else reading inventory (logistics, TPL managers,
    // finance) still sees the table but cannot download the raw levels.
    canExport: isAdminLevel(user) || user.role === 'STOCK_MANAGER',
    lowStockThreshold,
    canEditLowStock: isAdminLevel(user),
    lowStockAlerts,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'stockIntake') {
    await requirePermission(request, 'inventory.intake');
    const productId = formData.get('productId')?.toString() ?? '';
    const locationId = formData.get('locationId')?.toString() ?? '';
    const quantity = parseInt(formData.get('quantity')?.toString() ?? '0', 10);
    const factoryCost = formData.get('factoryCost')?.toString() ?? '';
    const landingCost = formData.get('landingCost')?.toString() ?? '0';

    if (!productId || !locationId || quantity < 1 || !factoryCost) {
      return json({ error: 'Product, location, quantity, and factory cost are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.intake', {
      method: 'POST',
      cookie,
      body: {
        productId,
        locationId,
        quantity,
        factoryCost,
        landingCost: landingCost || '0',
      },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to add stock') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function InventoryRoute() {
  const data = useLoaderData<typeof loader>() as unknown as InventoryStreamData;
  usePageRefreshOnEvent(['stock:updated', 'transfer:created']);
  return <InventoryPage {...data} />;
}
