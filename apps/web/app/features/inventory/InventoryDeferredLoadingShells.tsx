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
import { Tabs } from '~/components/ui/tabs';

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
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
    { key: 'dispatch', header: 'Dispatch', render: () => <TableCellTextPulse className="w-[6rem]" /> },
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

/** Main inventory hub — stock levels / shipments tabs + labeled stat strip + CompactTable pulse. */
export function InventoryOverviewLoadingShell() {
  const levelRows = shellPulsePlaceholderRows('inv_levels', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Inventory"
        description="Pick Stock levels or Shipments below — shelf totals vs inbound receive/verify."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Inventory tools"
            sheetSubtitle={<span>Threshold, receive shipment, and export</span>}
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
      <Tabs
        value="levels"
        onChange={() => {}}
        tabs={[
          { value: 'levels', label: 'Stock levels' },
          { value: 'movements', label: 'Movements' },
          { value: 'shipments', label: 'Shipments' },
        ]}
      />
      <OverviewStatStrip
        items={[
          { label: 'Shipments', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total Stock', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Reserved', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Available', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Movements', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="card p-0 overflow-hidden">
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
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-64 max-w-full rounded bg-app-hover animate-pulse" aria-hidden />
      <OverviewStatStrip
        tileClassName="min-w-[7rem]"
        items={[
          { label: 'Stock', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Reserved', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Available', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Status', value: <StatValuePulse className="min-w-[4rem]" /> },
          { label: 'In (period)', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Out (period)', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Net', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Events', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="h-10 w-full max-w-md rounded-lg border border-app-border bg-app-hover animate-pulse" aria-hidden />
      <Tabs
        value="batches"
        onChange={() => {}}
        tabs={[
          { value: 'batches', label: 'Received stock / costing' },
          { value: 'audit', label: 'Movement log' },
        ]}
      />
      <div className="card p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
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
        description="Company-owned warehouse sites and inbound shipment targets."
        actions={<PageRefreshButton />}
      />
      <OverviewStatStrip
        items={[
          { label: 'Active warehouses', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Warehouses with stock available', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Dispatch locked', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total available units', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      <CompactTable<{ id: string }>
        columns={warehousesShellColumns()}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
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
        description="All inbound shipments received (or planned) for this warehouse."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <span className="h-8 w-32 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
          </div>
        }
      />
      <div className="card p-0 overflow-x-auto">
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

/** Global shipments list (Shipments tab route). */
export function ShipmentsListLoadingShell() {
  const rows = shellPulsePlaceholderRows('ship_list', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Inbound Shipments"
        description="Receive supplier deliveries into your warehouses. Verify to post into inventory and create FIFO batches."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <span className="h-8 w-28 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
          </div>
        }
      />
      <CompactTable<{ id: string }>
        columns={SHIPMENTS_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** Shipment detail workflow. */
export function ShipmentDetailLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="h-7 w-56 max-w-full rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-4 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
        </div>
        <div className="h-9 w-28 rounded-md bg-app-hover animate-pulse shrink-0" aria-hidden />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
        <div className="card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Product categories. */
export function CategoriesLoadingShell() {
  const rows = shellPulsePlaceholderRows('categories', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader title="Categories" description="Organize products." actions={<PageRefreshButton />} />
      <CompactTable<{ id: string }>
        columns={CATEGORIES_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}
