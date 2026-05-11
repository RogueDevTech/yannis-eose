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
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DescriptionList } from '~/components/ui/description-list';

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

/** Main inventory hub — stock levels plus summary stats and compact table pulse. */
export function InventoryOverviewLoadingShell() {
  const levelRows = shellPulsePlaceholderRows('inv_levels', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Inventory"
        description="Track on-hand stock, reservations, and reconciliation. Manage inbound supplier receipts from the separate Shipments page."
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
          { value: 'transfers', label: 'Transfers' },
          { value: 'reconciliation', label: 'Reconciliation' },
        ]}
      />
      <OverviewStatStrip
        items={[
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

/** Global standalone shipments list. */
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
        description={
          (
            <span className="inline-block h-3.5 w-56 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
          ) as unknown as string
        }
        actions={
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
      />

      {/* Status timeline — step labels are static (we know all 5), the
          current-step highlight is unknown so every step renders neutral. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-app-fg-muted">
        {SHIPMENT_TIMELINE_STEPS.map((label, idx) => (
          <span key={label} className="flex items-center gap-2">
            <span
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-app-hover px-2 text-[10px] font-semibold text-app-fg-muted"
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
            divided
            className="gap-y-3"
            items={SHIPMENT_DETAIL_FIELDS.map((f) => ({
              label: f.label,
              value: <TableCellTextPulse className={f.pulseClass} />,
            }))}
          />
        </CardBody>
      </Card>

      {/* Line items — table chrome (column headers) is real, rows pulse. */}
      <Card>
        <CardHeader
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
        <CardBody>
          <CompactTable
            columns={lineColumns}
            rows={lineRows}
            rowKey={(r) => r.id}
            emptyTitle="Loading…"
            emptyDescription=""
          />
        </CardBody>
      </Card>
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
