import { useState } from 'react';
import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { Button } from '~/components/ui/button';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';

export type StockOutProductRow = {
  productId: string;
  productName: string;
  soldQty: number;
  reversedQty: number;
  writtenOffQty: number;
  totalQty: number;
  transactionCount: number;
};

export type StockOutSummary = {
  products: StockOutProductRow[];
  totals: { soldQty: number; writtenOffQty: number; totalQty: number; transactionCount: number };
};

export type StockOutPageData = {
  summary: StockOutSummary;
  loadError: string | null;
  startDate: string | null;
  endDate: string | null;
  periodAllTime: boolean;
  canExport: boolean;
};

export const fmt = (n: number) => n.toLocaleString('en-NG');

export function periodLabel(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return 'All time';
  if (startDate === endDate) return startDate ?? '';
  return `${startDate ?? 'Start'} to ${endDate ?? 'today'}`;
}

/** Query string that keeps the chosen period when moving between the summary and a product. */
export function stockOutPeriodSearch(startDate: string | null, endDate: string | null, periodAllTime: boolean): string {
  const sp = new URLSearchParams();
  if (periodAllTime) sp.set('period', 'all_time');
  else {
    if (startDate) sp.set('startDate', startDate);
    if (endDate) sp.set('endDate', endDate);
  }
  const q = sp.toString();
  return q ? `?${q}` : '';
}

function summaryColumns(productHref: (row: StockOutProductRow) => string): CompactTableColumn<StockOutProductRow>[] {
  return [
    {
      key: 'product',
      header: 'Product',
      render: (r) => <span className="font-medium text-app-fg">{r.productName}</span>,
    },
    {
      key: 'sold',
      header: 'Sold',
      align: 'right',
      nowrap: true,
      cellClassName: 'tabular-nums',
      cellTitle: (r) => (r.reversedQty > 0 ? `${fmt(r.reversedQty)} reversed deliveries already subtracted` : undefined),
      render: (r) => fmt(r.soldQty),
    },
    {
      key: 'writtenOff',
      header: 'Written off',
      align: 'right',
      nowrap: true,
      cellClassName: 'tabular-nums',
      render: (r) => (r.writtenOffQty ? fmt(r.writtenOffQty) : <span className="text-app-fg-muted">0</span>),
    },
    {
      key: 'total',
      header: 'Total out',
      align: 'right',
      nowrap: true,
      cellClassName: 'tabular-nums font-semibold text-app-fg',
      render: (r) => fmt(r.totalQty),
    },
    {
      key: 'transactions',
      header: 'Transactions',
      align: 'right',
      nowrap: true,
      hideOnMobile: true,
      cellClassName: 'tabular-nums text-app-fg-muted',
      render: (r) => fmt(r.transactionCount),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      tight: true,
      hideOnMobile: true,
      render: (r) => <CompactTableActionButton to={productHref(r)}>View</CompactTableActionButton>,
    },
  ];
}

export function StockOutPage({ summary, loadError, startDate, endDate, periodAllTime, canExport }: StockOutPageData) {
  const [exportKey, setExportKey] = useState<'stock_out_summary' | 'stock_out_transactions' | null>(null);

  const period = periodLabel(startDate, endDate);
  const periodSearch = stockOutPeriodSearch(startDate, endDate, periodAllTime);
  const productHref = (r: StockOutProductRow) => `/admin/inventory/stock-out/${r.productId}${periodSearch}`;

  const openExport = (key: 'stock_out_summary' | 'stock_out_transactions') => setExportKey(key);

  const exportButtons = (onDone?: () => void, mobile = false) =>
    canExport ? (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={mobile ? 'h-12 w-full justify-center' : undefined}
          onClick={() => { onDone?.(); openExport('stock_out_summary'); }}
        >
          Export summary
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={mobile ? 'h-12 w-full justify-center' : undefined}
          onClick={() => { onDone?.(); openExport('stock_out_transactions'); }}
        >
          Export transactions
        </Button>
      </>
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock out"
        mobileInlineActions
        description="Units sold and written off per product."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Stock out tools"
            triggerAriaLabel="Stock out toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={startDate ?? undefined}
                  endDate={endDate ?? undefined}
                  periodAllTime={periodAllTime}
                  chrome="pill"
                />
                {exportButtons()}
              </>
            }
            sheet={canExport ? ({ closeSheet }) => exportButtons(closeSheet, true) : undefined}
          />
        }
      />

      <MobileDateFilterRow
        startDate={startDate ?? undefined}
        endDate={endDate ?? undefined}
        periodAllTime={periodAllTime}
      />

      <OverviewStatStrip
        mobileGrid
        tileClassName="min-w-[7rem]"
        items={[
          { label: 'Total out', value: fmt(summary.totals.totalQty), valueClassName: 'text-app-fg', title: period },
          { label: 'Sold', value: fmt(summary.totals.soldQty), valueClassName: 'text-success-600 dark:text-success-400', title: 'Delivered units, minus reversed deliveries' },
          { label: 'Written off', value: fmt(summary.totals.writtenOffQty), valueClassName: 'text-danger-600 dark:text-danger-400' },
          { label: 'Products', value: fmt(summary.products.length), valueClassName: 'text-app-fg' },
        ]}
      />

      {loadError ? (
        <EmptyState variant="card" title="Could not load stock out" description={loadError} />
      ) : (
        <CompactTable<StockOutProductRow>
          rows={summary.products}
          rowKey={(r) => r.productId}
          columns={summaryColumns(productHref)}
          emptyTitle="No stock out in this period"
          emptyDescription="Pick a wider date range."
          renderMobileCard={(r) => (
            <Link
              to={productHref(r)}
              className="flex w-full flex-col gap-1 py-3 px-1 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-app-fg truncate">{r.productName}</span>
                <span className="font-semibold tabular-nums text-app-fg shrink-0">{fmt(r.totalQty)}</span>
              </span>
              <span className="text-xs text-app-fg-muted tabular-nums">
                Sold {fmt(r.soldQty)} · Written off {fmt(r.writtenOffQty)} · {fmt(r.transactionCount)} txns
              </span>
            </Link>
          )}
        />
      )}

      {exportKey && (
        <ExportModal
          open
          onClose={() => setExportKey(null)}
          config={EXPORT_CONFIGS[exportKey]}
          initialDateRange={{ startDate, endDate }}
        />
      )}
    </div>
  );
}
