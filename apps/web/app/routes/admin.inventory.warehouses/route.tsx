import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  parsePerPage,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import {
  WarehousesPage,
  type WarehouseRow,
} from '~/features/inventory/WarehousesPage';
import { WarehousesListLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Our warehouse — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');
  const url = new URL(request.url);
  // This route only lists company-owned warehouses (`provider.kind = WAREHOUSE`).
  // Strip legacy `scope` query params so bookmarks to the old "all sites" view normalize here.
  if (url.searchParams.has('scope')) {
    const next = new URL(request.url);
    next.searchParams.delete('scope');
    const qs = next.searchParams.toString();
    return redirect(`${next.pathname}${qs ? `?${qs}` : ''}`);
  }

  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  // URL-driven page size — clamped to [20, 50, 100]; fallback 20.
  const { perPage } = parsePerPage(url.searchParams);
  const search = (url.searchParams.get('search') ?? '').trim();
  const rawSortBy = url.searchParams.get('sortBy') ?? '';
  const rawSortDir = url.searchParams.get('sortDir') ?? '';
  const sortBy: 'createdAt' | 'name' | 'available' =
    rawSortBy === 'name' || rawSortBy === 'available' ? rawSortBy : 'createdAt';
  const sortDir: 'asc' | 'desc' = rawSortDir === 'asc' ? 'asc' : 'desc';

  const pageData = (async () => {
    const user = await getCurrentUser(request);
    const cookie = getSessionCookie(request);

    const listInput: {
      status: 'ACTIVE';
      page: number;
      limit: number;
      listScope: 'our';
      search?: string;
      sortBy: 'createdAt' | 'name' | 'available';
      sortOrder: 'asc' | 'desc';
    } = {
      status: 'ACTIVE',
      page,
      limit: perPage,
      listScope: 'our',
      sortBy,
      sortOrder: sortDir,
    };
    if (search.length > 0) listInput.search = search;

    const input = JSON.stringify(listInput);
    const [res, overviewRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/inventory.warehouses.list?input=${encodeURIComponent(input)}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/inventory.warehouses.overview', { method: 'GET', cookie }),
    ]);
    let warehouses: WarehouseRow[] = [];
    let totalWarehouses = 0;
    if (res.ok) {
      const data = (res.data as {
        result?: {
          data?: {
            warehouses: Array<
              Omit<WarehouseRow, 'stockSummary' | 'providerKind' | 'providerName'> & {
                stockSummary?: WarehouseRow['stockSummary'];
                providerKind?: string;
                providerName?: string | null;
              }
            >;
            pagination: { total: number };
          };
        };
      })?.result?.data;
      const rows = data?.warehouses ?? [];
      warehouses = rows.map((w) => ({
        ...w,
        providerKind: w.providerKind === 'WAREHOUSE' ? 'WAREHOUSE' : 'THIRD_PARTY',
        providerName: (w.providerName ?? '').trim() || 'Partner',
        stockSummary: w.stockSummary ?? { totalStock: 0, totalReserved: 0, skuCount: 0 },
      }));
      totalWarehouses = data?.pagination?.total ?? 0;
    }

    const totalPages = Math.max(1, Math.ceil(totalWarehouses / perPage));

    const actorPerms = new Set((user?.permissions ?? []).map((p) => canonicalPermissionCode(p)));
    const canManage =
      !!user &&
      (isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.warehouses.write')));

    const overview = overviewRes.ok
      ? ((overviewRes.data as {
          result?: {
            data?: {
              activeWarehousesCount: number;
              warehousesWithAvailableStockCount: number;
              dispatchLockedCount: number;
              totalUnits: number;
              totalReserved: number;
              totalAvailable: number;
              skuCount: number;
            };
          };
        })?.result?.data ?? null)
      : null;

    return {
      warehouses,
      totalWarehouses,
      page,
      limit: perPage,
      totalPages,
      search,
      sortBy,
      sortDir,
      canManage,
      overview: overview ?? {
        activeWarehousesCount: 0,
        warehousesWithAvailableStockCount: 0,
        dispatchLockedCount: 0,
        totalUnits: 0,
        totalReserved: 0,
        totalAvailable: 0,
        skuCount: 0,
      },
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  if (intent === 'createWarehouse') {
    await requirePermission(request, 'inventory.warehouses.write');
    const name = fd.get('name')?.toString().trim() ?? '';
    const address = fd.get('address')?.toString().trim() ?? '';
    const coordinates = fd.get('coordinates')?.toString().trim() ?? '';
    if (name.length < 2 || address.length < 2) {
      return json({ error: 'Name and address are required.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.warehouses.create', {
      method: 'POST',
      cookie,
      body: { name, address, coordinates },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create warehouse') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'updateWarehouse') {
    await requirePermission(request, 'inventory.warehouses.write');
    const warehouseId = fd.get('warehouseId')?.toString().trim() ?? '';
    const name = fd.get('name')?.toString().trim() ?? '';
    const address = fd.get('address')?.toString().trim() ?? '';
    const coordinates = fd.get('coordinates')?.toString().trim() ?? '';
    if (!warehouseId) {
      return json({ error: 'Missing warehouse id.' }, { status: 400 });
    }
    if (name.length < 2 || address.length < 2) {
      return json({ error: 'Name and address are required.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.warehouses.update', {
      method: 'POST',
      cookie,
      body: { warehouseId, name, address, coordinates },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update warehouse') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function WarehousesRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<WarehousesListLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
          <WarehousesPage
            warehouses={data.warehouses}
            totalWarehouses={data.totalWarehouses}
            page={data.page}
            limit={data.limit}
            totalPages={data.totalPages}
            search={data.search}
            sortBy={data.sortBy}
            sortDir={data.sortDir}
            canManage={data.canManage}
            overview={data.overview}
          />
        )}
    </CachedAwait>
  );
}
