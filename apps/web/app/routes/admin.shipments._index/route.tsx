import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  parsePerPage,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import type { LocationOption, ShipmentRow, ShipmentStatus } from '~/features/inventory/types';
import { ShipmentsTab } from '~/features/inventory/ShipmentsTab';
import { ShipmentsListLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Shipments — Yannis EOSE' }];

const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;
const SHIPMENT_STATUS_FILTERS: Array<{ value: '' | ShipmentStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'CREATED', label: 'Created' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'ARRIVED', label: 'Arrived' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'inventory.shipments.read');
  const cookie = getSessionCookie(request);
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));

  const url = new URL(request.url);
  const rawStatus = (url.searchParams.get('status') ?? '').trim();
  const status = SHIPMENT_STATUS_FILTERS.some((item) => item.value === rawStatus)
    ? rawStatus
    : '';
  const search = (url.searchParams.get('search') ?? '').trim();
  const destinationLocationId = (url.searchParams.get('destinationLocationId') ?? '').trim();
  const fromDate = (url.searchParams.get('fromDate') ?? '').trim();
  const toDate = (url.searchParams.get('toDate') ?? '').trim();
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  // URL-driven page size — clamped to [20, 50, 100]; fallback 20.
  const { perPage: LIMIT } = parsePerPage(url.searchParams);

  const receive = url.searchParams.get('receive') === '1';
  if (receive) {
    return redirect('/admin/shipments/receive');
  }

  const pageData = (async () => {
    const shipmentsInput = {
      page,
      limit: LIMIT,
      ...(status && { status }),
      ...(search && { search }),
      ...(destinationLocationId && { destinationLocationId }),
      ...(fromDate && { fromDate }),
      ...(toDate && { toDate }),
    };
    const shipmentsPromise = apiRequest<unknown>(
      `/trpc/inventory.shipments.list?input=${encodeURIComponent(JSON.stringify(shipmentsInput))}`,
      { method: 'GET', cookie, ...readOpts },
    );

    const locationsPromise = apiRequest<unknown>(
      `/trpc/logistics.locationOptions?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', providerKind: 'WAREHOUSE' }))}`,
      { method: 'GET', cookie, ...readOpts },
    );

    const [shipmentsRes, locationsRes] = await Promise.all([
      shipmentsPromise,
      locationsPromise,
    ]);

    const shipmentsData = shipmentsRes.ok
      ? ((shipmentsRes.data as { result?: { data?: { rows: ShipmentRow[]; pagination: { total: number; totalPages: number }; summary?: Record<string, number> } } })
          ?.result?.data ?? null)
      : null;

    const locationsData = locationsRes.ok
      ? ((locationsRes.data as {
          result?: {
            data?: Array<{
              id: string;
              name: string;
              providerName?: string | null;
              providerKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
            }>;
          };
        })
          ?.result?.data ?? null)
      : null;

    const locations: LocationOption[] = (locationsData ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
      providerKind: l.providerKind ?? null,
    }));

    return {
      shipments: shipmentsData?.rows ?? [],
      totalShipments: shipmentsData?.pagination?.total ?? 0,
      totalPages: shipmentsData?.pagination?.totalPages ?? 1,
      page,
      limit: LIMIT,
      locations,
      summary: {
        total: Number(shipmentsData?.summary?.total ?? 0),
        created: Number(shipmentsData?.summary?.created ?? 0),
        inTransit: Number(shipmentsData?.summary?.inTransit ?? 0),
        arrived: Number(shipmentsData?.summary?.arrived ?? 0),
        verified: Number(shipmentsData?.summary?.verified ?? 0),
        closed: Number(shipmentsData?.summary?.closed ?? 0),
        cancelled: Number(shipmentsData?.summary?.cancelled ?? 0),
      },
      filters: {
        status,
        search,
        destinationLocationId,
        fromDate,
        toDate,
      },
      canIntake:
        isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.intake')),
      loadError:
        shipmentsRes.ok && locationsRes.ok
          ? null
          : [
              !shipmentsRes.ok ? extractApiErrorMessage(shipmentsRes.data, 'Failed to load shipments') : null,
              !locationsRes.ok ? extractApiErrorMessage(locationsRes.data, 'Failed to load warehouses') : null,
            ].filter(Boolean).join(' · ') || 'Failed to load shipment page data',
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create shipment') },
        { status: safeStatus(res.status) },
      );
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
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update shipment') },
        { status: safeStatus(res.status) },
      );
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
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to cancel shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

function ShipmentsIndexContent(data: {
  shipments: ShipmentRow[];
  totalShipments: number;
  totalPages: number;
  page: number;
  limit: number;
  locations: LocationOption[];
  summary: {
    total: number;
    created: number;
    inTransit: number;
    arrived: number;
    verified: number;
    closed: number;
    cancelled: number;
  };
  filters: {
    status: string;
    search: string;
    destinationLocationId: string;
    fromDate: string;
    toDate: string;
  };
  canIntake: boolean;
  loadError: string | null;
}) {
  const activeFilters = [
    data.filters.status,
    data.filters.search,
    data.filters.destinationLocationId,
    data.filters.fromDate,
    data.filters.toDate,
  ].filter((value) => value !== '');
  const hasActiveFilters = activeFilters.length > 0;

  const statusFilterOptions = SHIPMENT_STATUS_FILTERS.map((item) => ({
    value: item.value,
    label: item.label,
  }));
  const warehouseFilterOptions = [
    { value: '', label: 'All warehouses' },
    ...data.locations.map((location) => ({ value: location.id, label: location.name })),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbound Shipments"
        mobileInlineActions
        description="Receive and verify supplier shipments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Shipment tools"
            sheetSubtitle={<span>Filter, refresh and receive shipments</span>}
            triggerAriaLabel="Shipment toolbar"
            filtersBadgeCount={activeFilters.length}
            filters={
              <form method="get" className="space-y-3">
                <FormSelect
                  name="status"
                  defaultValue={data.filters.status}
                  wrapperClassName="w-full"
                  controlSize="lg"
                  className="!bg-app-hover text-center"
                  options={statusFilterOptions}
                />
                <FormSelect
                  name="destinationLocationId"
                  defaultValue={data.filters.destinationLocationId}
                  wrapperClassName="w-full"
                  controlSize="lg"
                  className="!bg-app-hover text-center"
                  options={warehouseFilterOptions}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextInput label="From" type="date" name="fromDate" defaultValue={data.filters.fromDate} />
                  <TextInput label="To" type="date" name="toDate" defaultValue={data.filters.toDate} />
                </div>
                {/* Search lives in its own bar on the page — carry the current
                    term so applying filters here does not drop it. */}
                <input type="hidden" name="search" defaultValue={data.filters.search} />
                <div className="flex items-center gap-2">
                  <button type="submit" className="btn-primary btn-sm flex-1 justify-center">
                    Apply filters
                  </button>
                  {hasActiveFilters ? (
                    <Link to="/admin/shipments" prefetch="intent" className="btn-ghost btn-sm">
                      Reset
                    </Link>
                  ) : null}
                </div>
              </form>
            }
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <Link to="/admin/inventory" prefetch="intent" className="btn-secondary btn-sm">
                  View inventory
                </Link>
                {data.canIntake ? (
                  <Link to="/admin/shipments/receive" prefetch="intent" className="btn-primary btn-sm">
                    Receive shipment
                  </Link>
                ) : null}
              </div>
            }
            sheet={
              <>
                {data.canIntake ? (
                  <Link
                    to="/admin/shipments/receive"
                    prefetch="intent"
                    className="btn-secondary btn-sm w-full justify-center"
                  >
                    Receive shipment
                  </Link>
                ) : null}
                <Link
                  to="/admin/inventory"
                  prefetch="intent"
                  className="btn-secondary btn-sm w-full justify-center"
                >
                  View inventory
                </Link>
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total', value: data.summary.total, valueClassName: 'text-app-fg' },
          { label: 'Created', value: data.summary.created, valueClassName: 'text-app-fg' },
          { label: 'In transit', value: data.summary.inTransit, valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'Arrived', value: data.summary.arrived, valueClassName: 'text-brand-600 dark:text-brand-400' },
          { label: 'Verified', value: data.summary.verified, valueClassName: 'text-success-600 dark:text-success-400' },
          { label: 'Closed', value: data.summary.closed, valueClassName: 'text-success-600 dark:text-success-400' },
          { label: 'Cancelled', value: data.summary.cancelled, valueClassName: 'text-danger-600 dark:text-danger-400' },
        ]}
      />

      {/* Desktop-only filter bar — on mobile these filters live in the
          page-header kebab (Action icon group). */}
      <div className="card p-4 space-y-3 hidden md:block">
        <form method="get" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <FormSelect
              label="Status"
              name="status"
              defaultValue={data.filters.status}
              wrapperClassName="w-full sm:w-48"
              options={statusFilterOptions}
            />
            <FormSelect
              label="Warehouse"
              name="destinationLocationId"
              defaultValue={data.filters.destinationLocationId}
              wrapperClassName="w-full sm:w-56"
              options={warehouseFilterOptions}
            />
            <div className="w-full sm:w-40">
              <TextInput label="From" type="date" name="fromDate" defaultValue={data.filters.fromDate} />
            </div>
            <div className="w-full sm:w-40">
              <TextInput label="To" type="date" name="toDate" defaultValue={data.filters.toDate} />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchInput
              name="search"
              defaultValue={data.filters.search}
              placeholder="Search label, supplier, or supplier ref…"
              wrapperClassName="w-full"
              withSubmitButton={false}
            />
            <div className="flex items-center gap-2 shrink-0">
              <button type="submit" className="btn-primary btn-sm">
                Apply filters
              </button>
              {hasActiveFilters ? (
                <Link to="/admin/shipments" prefetch="intent" className="btn-ghost btn-sm">
                  Reset
                </Link>
              ) : null}
            </div>
          </div>
        </form>
      </div>

      {/* Mobile search bar — search stays on the page; the other filters live
          in the page-header kebab. Hidden fields carry the active filters so a
          search submit does not drop them. */}
      <form method="get" className="md:hidden">
        <input type="hidden" name="status" defaultValue={data.filters.status} />
        <input type="hidden" name="destinationLocationId" defaultValue={data.filters.destinationLocationId} />
        <input type="hidden" name="fromDate" defaultValue={data.filters.fromDate} />
        <input type="hidden" name="toDate" defaultValue={data.filters.toDate} />
        <SearchInput
          name="search"
          defaultValue={data.filters.search}
          placeholder="Search label, supplier, or ref…"
          wrapperClassName="w-full"
          withSubmitButton
        />
      </form>

      {data.loadError && (
        <div className="card p-4 text-sm text-danger-700 dark:text-danger-300">
          {data.loadError}
        </div>
      )}

      <div className="card p-0">
        <ShipmentsTab
          shipments={data.shipments}
          totalShipments={data.totalShipments}
          canIntake={data.canIntake}
        />
      </div>

      {data.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.totalShipments)} of{' '}
            {data.totalShipments} shipments
          </p>
          <Pagination page={data.page} totalPages={data.totalPages} pageParam="page" pageSize={data.limit} />
        </div>
      )}
    </div>
  );
}

export default function ShipmentsIndexRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<ShipmentsListLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => <ShipmentsIndexContent {...data} />}
    </CachedAwait>
  );
}
