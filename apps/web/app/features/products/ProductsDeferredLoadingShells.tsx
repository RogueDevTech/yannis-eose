import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';

function productsHubShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    {
      key: 'product',
      header: 'Product',
      minWidth: 'min-w-[200px]',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[14rem]" />,
    },
    { key: 'category', header: 'Category', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    {
      key: 'price',
      header: 'Base Price',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[5rem]" />
        </span>
      ),
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
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      render: () => (
        <span className="inline-flex gap-1">
          <CompactTableActionButton disabled>View</CompactTableActionButton>
          <CompactTableActionButton disabled>Edit</CompactTableActionButton>
        </span>
      ),
    },
  ];
}

/** Single product view / edit chrome pulse. */
export function ProductDetailLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-56 rounded bg-app-hover animate-pulse" aria-hidden />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-4 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
        <div className="card p-6 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Products hub — products + offers tabs, stat strip, list pulse. */
export function ProductsHubLoadingShell({ initialTab }: { initialTab: 'product' | 'offers' }) {
  const rows = shellPulsePlaceholderRows('products_hub', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Products"
        mobileInlineActions
        description="Manage products and offers."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Product toolbar"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <span className="h-8 w-28 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
                <span className="h-8 w-28 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </div>
            }
            sheet={
              <>
                <span className="h-9 w-full animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
                <span className="h-9 w-full animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </>
            }
          />
        }
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Products', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Active', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Categories', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Offers available', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <Tabs
        value={initialTab}
        onChange={() => {}}
        tabs={[
          { value: 'product', label: 'Product' },
          { value: 'offers', label: 'Offers' },
        ]}
      />
      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            {/* Row 1: name + status */}
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-36 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
            </div>
            {/* Row 2: category + price */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
            </div>
            {/* Row 3: stock */}
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={productsHubShellColumns()}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}
