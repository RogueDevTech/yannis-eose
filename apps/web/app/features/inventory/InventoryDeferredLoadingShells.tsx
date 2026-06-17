import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import {
  shellPulsePlaceholderRows,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Tabs } from '~/components/ui/tabs';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DescriptionList } from '~/components/ui/description-list';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SortMenu } from '~/components/ui/sort-menu';
import { TextInput } from '~/components/ui/text-input';

const SHELL_PAGINATION_FOOTER = (
  <div className="flex flex-col gap-3 border-t border-app-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="m-0 flex min-h-[1.25rem] items-center text-sm">
      <span
        className="inline-block h-4 w-48 max-w-[90vw] animate-pulse rounded-md bg-app-border/75 dark:bg-app-border/60 sm:w-64"
        aria-hidden
      />
    </p>
    <div className="flex shrink-0 items-center gap-2" aria-hidden>
      <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
      <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
      <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
    </div>
  </div>
);

function inventoryLevelsShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'product', header: 'Product', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    { key: 'location', header: 'Location', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    {
      key: 'shipments',
      header: 'Shipment (FIFO)',
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3.5rem]" />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableCellTextPulse className="w-[5rem]" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => (
        <span className="inline-flex gap-1">
          <CompactTableActionButton disabled>View</CompactTableActionButton>
          <CompactTableActionButton disabled>Reconcile</CompactTableActionButton>
        </span>
      ),
    },
  ];
}

const SHIPMENTS_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'ref', header: 'Reference', render: () => <TableCellTextPulse className="w-[9rem]" /> },
  { key: 'supplier', header: 'Supplier', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  { key: 'destination', header: 'Destination', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'expected',
    header: 'Expected',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'lines',
    header: 'Lines',
    align: 'right',
    render: () => (
      <span className="inline-flex w-full justify-end">
        <TableCellTextPulse className="w-[2.5rem]" />
      </span>
    ),
  },
  {
    key: 'landing',
    header: 'Landing',
    align: 'right',
    render: () => (
      <span className="inline-flex w-full justify-end">
        <TableCellTextPulse className="w-[5rem]" />
      </span>
    ),
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
  },
];

function warehousesShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'site', header: 'Site', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    { key: 'address', header: 'Address', render: () => <TableCellTextPulse className="w-[14rem]" /> },
    {
      key: 'skus',
      header: 'SKUs',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'totalUnits',
      header: 'Total units',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4rem]" />
        </span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4rem]" />
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

const CATEGORIES_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  {
    key: 'num',
    header: '#',
    align: 'right',
    render: () => (
      <span className="inline-flex w-full justify-end">
        <TableCellTextPulse className="w-[2rem]" />
      </span>
    ),
  },
  { key: 'name', header: 'Category name', render: () => <TableCellTextPulse className="w-[14rem]" /> },
  { key: 'brand', header: 'Brand name', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  { key: 'contact', header: 'Brand contact', render: () => <TableCellTextPulse className="w-[12rem]" /> },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>Edit</CompactTableActionButton>,
  },
];

/** Main inventory hub — URL-driven stock-level filters; stats + table pulse. */
export function InventoryOverviewLoadingShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const levelRows = shellPulsePlaceholderRows('inv_levels', 8);

  const rawProduct = searchParams.get('productId') ?? '';
  const rawLocation = searchParams.get('locationId') ?? '';
  const rawShipment = searchParams.get('shipmentId') ?? '';
  const serverSearch = (searchParams.get('search') ?? '').trim();
  const legacySort = searchParams.get('sort') ?? '';
  const rawSortBy = searchParams.get('sortBy') ?? '';
  const rawSortDir = searchParams.get('sortDir') ?? '';

  const serverSortBy: 'available' | 'updatedAt' = useMemo(() => {
    if (rawSortBy === 'available' || rawSortBy === 'updatedAt') return rawSortBy;
    if (legacySort === 'lowestAvailable' || legacySort === 'highestAvailable') return 'available';
    return 'updatedAt';
  }, [rawSortBy, legacySort]);

  const serverSortDir: 'asc' | 'desc' = useMemo(() => {
    if (rawSortDir === 'asc' || rawSortDir === 'desc') return rawSortDir;
    if (legacySort === 'lowestAvailable') return 'asc';
    if (legacySort === 'highestAvailable') return 'desc';
    return 'desc';
  }, [rawSortDir, legacySort]);

  const currentProduct = rawProduct || 'ALL';
  const currentLocation = rawLocation || 'ALL';
  const currentShipment = rawShipment || 'ALL';

  const [searchInput, setSearchInput] = useState(serverSearch);
  useEffect(() => {
    setSearchInput(serverSearch);
  }, [serverSearch]);

  const updateLevelsParam = useCallback(
    (key: 'productId' | 'locationId' | 'shipmentId' | 'sort' | 'search', value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === 'ALL' || value === 'default') next.delete(key);
        else next.set(key, value);
        next.delete('page');
        return next;
      }, { preventScrollReset: true });
    },
    [setSearchParams],
  );

  const updateLevelsSort = useCallback(
    (sortBy: 'available' | 'updatedAt', sortDir: 'asc' | 'desc') => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const isDefault = sortBy === 'updatedAt' && sortDir === 'desc';
        if (isDefault) {
          next.delete('sortBy');
          next.delete('sortDir');
          next.delete('sort');
        } else {
          next.set('sortBy', sortBy);
          next.set('sortDir', sortDir);
          next.delete('sort');
        }
        next.delete('page');
        return next;
      }, { preventScrollReset: true });
    },
    [setSearchParams],
  );

  const resetLevelsFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('productId');
      next.delete('locationId');
      next.delete('shipmentId');
      next.delete('sort');
      next.delete('sortBy');
      next.delete('sortDir');
      next.delete('search');
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  }, [setSearchParams]);

  const submitSearch = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed === serverSearch) return;
      updateLevelsParam('search', trimmed);
    },
    [serverSearch, updateLevelsParam],
  );

  const productOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All products' }];
    if (currentProduct !== 'ALL') base.push({ value: currentProduct, label: 'Selected product' });
    return base;
  }, [currentProduct]);

  const locationOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All locations' }];
    if (currentLocation !== 'ALL') base.push({ value: currentLocation, label: 'Selected location' });
    return base;
  }, [currentLocation]);

  const shipmentOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All shipments' }];
    if (currentShipment !== 'ALL') base.push({ value: currentShipment, label: 'Selected shipment' });
    return base;
  }, [currentShipment]);

  const hasActiveFilters =
    currentProduct !== 'ALL' ||
    currentLocation !== 'ALL' ||
    currentShipment !== 'ALL' ||
    legacySort !== '' ||
    serverSortBy !== 'updatedAt' ||
    serverSortDir !== 'desc' ||
    serverSearch.length > 0;

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Inventory"
        mobileInlineActions
        description="Track stock and reservations."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Inventory toolbar"
            desktop={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <PageRefreshButton />
                <span
                  className="inline-flex h-8 min-w-[7rem] animate-pulse rounded-md border border-app-border bg-app-hover"
                  aria-hidden
                />
              </div>
            }
            sheet={<div className="h-10 w-full animate-pulse rounded-md bg-app-hover" aria-hidden />}
          />
        }
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total Stock', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Reserved', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Available', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Total Locations', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <Tabs
        value="levels"
        onChange={() => {}}
        tabs={[
          { value: 'levels', label: 'Stock levels' },
          { value: 'transfers', label: 'Transfers' },
          { value: 'reconciliation', label: 'Reconciliation' },
        ]}
      />

      {/* Desktop filters */}
      <div className="hidden md:flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchableSelect
          id="levels-product-filter-shell"
          value={currentProduct}
          onChange={(v) => updateLevelsParam('productId', v)}
          wrapperClassName="w-full sm:w-48"
          placeholder="All products"
          searchPlaceholder="Search products…"
          options={productOptions}
        />
        <SearchableSelect
          id="levels-location-filter-shell"
          value={currentLocation}
          onChange={(v) => updateLevelsParam('locationId', v)}
          wrapperClassName="w-full min-w-0 sm:w-48"
          placeholder="All locations"
          searchPlaceholder="Search locations…"
          options={locationOptions}
        />
        <SearchableSelect
          id="levels-shipment-filter-shell"
          value={currentShipment}
          onChange={(v) => updateLevelsParam('shipmentId', v)}
          wrapperClassName="w-full min-w-0 sm:w-52"
          placeholder="All shipments"
          searchPlaceholder="Search SHIP ref…"
          options={shipmentOptions}
        />
        <form
          method="get"
          className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch(searchInput);
          }}
        >
          <SearchInput
            name="search"
            placeholder="Search by product name…"
            value={searchInput}
            onChange={(val) => {
              setSearchInput(val);
              if (val === '') submitSearch('');
            }}
            withSubmitButton
            wrapperClassName="w-full"
          />
        </form>
        <SortMenu
          value={{ sortBy: serverSortBy, sortDir: serverSortDir }}
          onChange={(next) => updateLevelsSort(next.sortBy as 'available' | 'updatedAt', next.sortDir)}
          defaultValue={{ sortBy: 'updatedAt', sortDir: 'desc' }}
          options={[
            {
              value: 'updatedAt',
              label: 'Last updated',
              description: 'Most recently changed inventory rows.',
              ascLabel: 'Oldest first',
              descLabel: 'Newest first',
              defaultDir: 'desc',
            },
            {
              value: 'available',
              label: 'Available units',
              description: 'Stock count minus units reserved on open orders.',
              ascLabel: 'Lowest first',
              descLabel: 'Highest first',
              defaultDir: 'desc',
            },
          ]}
        />
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={resetLevelsFilters}
            className="text-xs text-brand-600 dark:text-brand-400 hover:underline self-center shrink-0"
          >
            Reset
          </button>
        ) : null}
      </div>

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-28 rounded bg-app-hover animate-pulse" />
              <div className="h-4 w-16 rounded bg-app-hover animate-pulse" />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block list-panel">
        <CompactTable<{ id: string }>
          withCard={false}
          columns={inventoryLevelsShellColumns()}
          rows={levelRows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
        {SHELL_PAGINATION_FOOTER}
      </div>
    </div>
  );
}

/** Single inventory level — header + stat strip + tabs pulse. */
export function InventoryLevelDetailLoadingShell() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {/* Breadcrumb placeholder */}
      <div className="h-3.5 w-28 rounded bg-app-hover animate-pulse" aria-hidden />
      {/* Title + description */}
      <div className="space-y-1.5">
        <div className="h-7 w-48 max-w-full rounded bg-app-hover animate-pulse" aria-hidden />
        <div className="h-4 w-36 rounded bg-app-hover animate-pulse" aria-hidden />
      </div>
      <OverviewStatStrip
        mobileGrid
        tileClassName="min-w-[7rem]"
        items={[
          { label: 'Stock', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Reserved', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Sold (period)', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      {/* Filter pills placeholder */}
      <div className="flex gap-2">
        <div className="h-8 w-16 rounded-full bg-app-hover animate-pulse" aria-hidden />
        <div className="h-8 w-16 rounded-full bg-app-hover animate-pulse" aria-hidden />
        <div className="h-8 w-16 rounded-full bg-app-hover animate-pulse" aria-hidden />
      </div>
      {/* Table rows placeholder */}
      <div className="card p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
        ))}
      </div>
    </div>
  );
}

/** Warehouses list — header + KPI strip + table. */
export function WarehousesListLoadingShell() {
  const rows = shellPulsePlaceholderRows('warehouses', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Our warehouses"
        mobileInlineActions
        description="Company sites used for intake, adjustments, and inbound shipments."
        actions={
          <>
            <PageRefreshButton className="hidden md:inline-flex" />
            <PageRefreshButton iconOnly className="md:hidden" />
          </>
        }
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Active warehouses', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Warehouses with stock available', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Dispatch locked', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total available units', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            {/* Row 1: name + status */}
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-28 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
            </div>
            {/* Row 2: SKUs + units + available */}
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
            </div>
            {/* Row 3: address */}
            <div className="h-3 w-40 rounded bg-app-hover animate-pulse" />
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={warehousesShellColumns()}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

/** Inbound shipments for one warehouse. */
export function WarehouseShipmentsLoadingShell() {
  const rows = shellPulsePlaceholderRows('wh_ship', 6);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Warehouse shipments"
        mobileInlineActions
        description="View warehouse shipments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Warehouse shipment toolbar"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <span className="h-8 w-32 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </div>
            }
            sheet={<span className="h-9 w-full animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />}
          />
        }
      />
      <div className="list-panel overflow-x-auto">
        <div className="h-10 w-full max-w-sm m-3 rounded bg-app-hover animate-pulse" aria-hidden />
        <CompactTable<{ id: string }>
          withCard={false}
          columns={SHIPMENTS_SHELL_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

const SHIPMENT_STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'CREATED', label: 'Created' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'ARRIVED', label: 'Arrived' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** Global standalone shipments list — GET filter form from URL; stats pulse; table pulse. */
export function ShipmentsListLoadingShell() {
  const [searchParams] = useSearchParams();
  const rows = shellPulsePlaceholderRows('ship_list', 8);

  const rawStatus = (searchParams.get('status') ?? '').trim();
  const status = SHIPMENT_STATUS_FILTER_OPTIONS.some((o) => o.value === rawStatus) ? rawStatus : '';
  const search = (searchParams.get('search') ?? '').trim();
  const destinationLocationId = (searchParams.get('destinationLocationId') ?? '').trim();
  const fromDate = (searchParams.get('fromDate') ?? '').trim();
  const toDate = (searchParams.get('toDate') ?? '').trim();

  const hasActiveFilters =
    status !== '' || search !== '' || destinationLocationId !== '' || fromDate !== '' || toDate !== '';

  const warehouseOptions = [{ value: '', label: 'All warehouses' }];
  if (destinationLocationId) {
    warehouseOptions.push({ value: destinationLocationId, label: 'Selected warehouse' });
  }

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Inbound Shipments"
        mobileInlineActions
        description="Receive and verify supplier shipments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Shipment toolbar"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <Link to="/admin/inventory" prefetch="intent" className="btn-secondary btn-sm">
                  View inventory
                </Link>
              </div>
            }
            sheet={
              <Link to="/admin/inventory" prefetch="intent" className="btn-secondary btn-sm w-full justify-center">
                View inventory
              </Link>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Created', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'In transit', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Arrived', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Verified', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Closed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Cancelled', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />

      <div className="card p-4 space-y-3">
        <form method="get" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <FormSelect
              label="Status"
              name="status"
              defaultValue={status}
              wrapperClassName="w-full sm:w-48"
              options={SHIPMENT_STATUS_FILTER_OPTIONS}
            />
            <SearchableSelect
              label="Warehouse"
              value={destinationLocationId}
              onChange={() => {}}
              wrapperClassName="w-full sm:w-56"
              placeholder="All warehouses"
              searchPlaceholder="Search warehouses..."
              options={warehouseOptions}
            />
            <div className="w-full sm:w-40">
              <TextInput label="From" type="date" name="fromDate" defaultValue={fromDate} />
            </div>
            <div className="w-full sm:w-40">
              <TextInput label="To" type="date" name="toDate" defaultValue={toDate} />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchInput
              name="search"
              defaultValue={search}
              placeholder="Search label, supplier, or supplier ref…"
              wrapperClassName="w-full"
              withSubmitButton={false}
            />
            <div className="flex shrink-0 items-center gap-2">
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

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            {/* Row 1: reference + status */}
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-24 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-app-hover animate-pulse" />
            </div>
            {/* Row 2: supplier -> destination */}
            <div className="flex items-center gap-2 text-xs">
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-4 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
            </div>
            {/* Row 3: lines + cost + date */}
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-28 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={SHIPMENTS_SHELL_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

/**
 * Shipment detail workflow — mirrors the real `ShipmentDetailPage` layout 1:1
 * so the page chrome (breadcrumb structure, page header, section headings,
 * field labels, table column headers, status-timeline steps) is visible
 * immediately. Only the data-dependent slots (reference label, status badge,
 * timeline current-step highlight, field VALUES, table rows) render as pulses
 * — this keeps the static layout grounded so the swap to real data feels like
 * a fill-in rather than a re-render.
 */
const SHIPMENT_TIMELINE_STEPS = ['Created', 'In transit', 'Arrived', 'Verified', 'Closed'] as const;

const SHIPMENT_DETAIL_FIELDS = [
  { label: 'Destination', pulseClass: 'w-[10rem]' },
  { label: 'Supplier', pulseClass: 'w-[8rem]' },
  { label: 'Supplier ref', pulseClass: 'w-[7rem]' },
  { label: 'Expected arrival', pulseClass: 'w-[9rem]' },
  { label: 'Arrived', pulseClass: 'w-[9rem]' },
  { label: 'Verified', pulseClass: 'w-[9rem]' },
  { label: 'Closed', pulseClass: 'w-[9rem]' },
  { label: 'Total landing cost', pulseClass: 'w-[6rem]' },
] as const;

const SHIPMENT_LINE_SHELL_ROWS = 4;

function shipmentLineShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'product', header: 'Product', render: () => <TableCellTextPulse className="w-[9rem]" /> },
    {
      key: 'warehouse',
      header: 'Warehouse',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    },
    {
      key: 'expected',
      header: 'Expected',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'received',
      header: 'Received',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'factory',
      header: 'Factory cost',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4rem]" />
        </span>
      ),
    },
    {
      key: 'landing',
      header: 'Allocated landing',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4rem]" />
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Variance',
      render: () => <TableCellTextPulse className="w-[5rem]" />,
    },
  ];
}

export function ShipmentDetailLoadingShell() {
  const lineRows = shellPulsePlaceholderRows('shipment-line', SHIPMENT_LINE_SHELL_ROWS);
  const lineColumns = shipmentLineShellColumns();

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {/* Breadcrumb — the section crumb is static, the trailing reference is a pulse */}
      <Breadcrumb
        items={[
          { label: 'Shipments', to: '/admin/shipments' },
          {
            label: (
              <span className="inline-block h-4 w-32 align-middle rounded bg-app-border/75 dark:bg-app-border/55 animate-pulse" />
            ) as unknown as string,
          },
        ]}
      />

      {/* Page header — `referenceLabel` and `label` are dynamic so they pulse;
          status badge + workflow buttons render as a neutral pill row + pulse
          buttons since which buttons are visible depends on status + perms. */}
      <PageHeader
        title={
          (
            <span className="inline-block h-6 w-44 rounded-md bg-app-border/75 dark:bg-app-border/55 animate-pulse align-middle" />
          ) as unknown as string
        }
        mobileInlineActions
        description={
          (
            <span className="inline-block h-3.5 w-56 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
          ) as unknown as string
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Shipment toolbar"
            mobileLeading={
              <span
                className="inline-block h-6 w-20 rounded-full bg-app-border/65 dark:bg-app-border/55 animate-pulse"
                aria-hidden
                aria-label="Status badge"
              />
            }
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-block h-6 w-20 rounded-full bg-app-border/65 dark:bg-app-border/55 animate-pulse"
                  aria-hidden
                  aria-label="Status badge"
                />
                <PageRefreshButton />
                <span
                  className="inline-block h-8 w-28 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse"
                  aria-hidden
                />
                <span
                  className="inline-block h-8 w-32 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse"
                  aria-hidden
                />
              </div>
            }
            sheet={
              <>
                <span className="inline-block h-9 w-full animate-pulse rounded-md bg-app-border/55 dark:bg-app-border/45" aria-hidden />
                <span className="inline-block h-9 w-full animate-pulse rounded-md bg-app-border/55 dark:bg-app-border/45" aria-hidden />
              </>
            }
          />
        }
      />

      {/* Status timeline — step labels are static (we know all 5), the
          current-step highlight is unknown so every step renders neutral. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-app-fg-muted">
        {SHIPMENT_TIMELINE_STEPS.map((label, idx) => (
          <span key={label} className="flex items-center gap-2">
            <span
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-app-hover px-2 text-micro font-semibold text-app-fg-muted"
              aria-hidden
            >
              {idx + 1}
            </span>
            <span>{label}</span>
            {idx < SHIPMENT_TIMELINE_STEPS.length - 1 ? (
              <span className="text-app-fg-muted/40" aria-hidden>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {/* Shipment details — labels visible, values pulse. Mirrors the
          `DescriptionList layout="grid" gridColumns={3}` on the real page. */}
      <Card>
        <CardHeader title="Shipment details" />
        <CardBody>
          <DescriptionList
            layout="grid"
            gridColumns={3}
            mobileColumns={2}
            divided
            className="gap-y-3"
            items={SHIPMENT_DETAIL_FIELDS.map((f) => ({
              label: f.label,
              value: <TableCellTextPulse className={f.pulseClass} />,
            }))}
          />
        </CardBody>
      </Card>

      {/* Line items — table chrome (column headers) is real, rows pulse.
          Card chrome is desktop-only to mirror the real page. */}
      <section className="md:rounded-xl md:border md:border-app-border md:bg-app-elevated md:p-4 md:shadow-card">
        <CardHeader
          className="mb-2 md:mb-4"
          title={
            <span className="inline-flex flex-wrap items-center gap-x-1">
              <span>Line items</span>
              <span className="inline-flex items-center gap-0.5 text-base font-semibold text-app-fg">
                <span aria-hidden>(</span>
                <span
                  className="inline-block h-5 w-6 rounded-md bg-app-border/80 dark:bg-app-border/65 animate-pulse align-middle"
                  aria-hidden
                />
                <span aria-hidden>)</span>
              </span>
            </span>
          }
        />
        <CompactTable
          columns={lineColumns}
          rows={lineRows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </section>
    </div>
  );
}

/** Product categories — URL search + stats pulse; table pulse. */
export function CategoriesLoadingShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rows = shellPulsePlaceholderRows('categories', 8);
  const search = searchParams.get('search') ?? '';
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    setDraft(search);
  }, [search]);

  const applySearch = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (draft.trim()) next.set('search', draft.trim());
      else next.delete('search');
      return next;
    }, { replace: true });
  };

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Product Categories"
        mobileInlineActions
        description="Manage product categories."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Category toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button type="button" variant="primary" disabled>
                  New Category
                </Button>
              </>
            }
            sheet={<Button type="button" variant="primary" size="sm" className="h-12 w-full justify-center" disabled>New Category</Button>}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        showScrollControls={false}
        items={[
          { label: 'Total Categories', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Active', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          applySearch();
        }}
        className="flex items-center gap-2"
      >
        <SearchInput
          value={draft}
          onChange={setDraft}
          placeholder="Search categories or brand names..."
          withSubmitButton
          wrapperClassName="flex-1 min-w-0"
        />
      </form>

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={CATEGORIES_SHELL_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}
