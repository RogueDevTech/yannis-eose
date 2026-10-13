import { useState } from 'react';
import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Card, CardBody } from '~/components/ui/card';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Button } from '~/components/ui/button';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { formatOrderTimestamp } from '~/lib/format-date';
import { fmt, periodLabel, stockOutPeriodSearch, type StockOutProductRow } from '~/features/inventory/StockOutPage';

export type StockOutTransaction = {
  id: string;
  createdAt: string;
  kind: 'SOLD' | 'REVERSAL' | 'WRITE_OFF';
  quantity: number;
  productId: string;
  productName: string;
  orderId: string | null;
  orderNumber: number | null;
  orderBranchId: string | null;
  locationName: string | null;
  actorName: string | null;
  reason: string | null;
};

export type StockOutProductPageData = {
  productId: string;
  productName: string;
  /** This product's summary row for the period; null when nothing went out. */
  summary: StockOutProductRow | null;
  transactions: StockOutTransaction[];
  /** Sum of every transaction in the period (all pages), from the API. */
  transactionsTotalQty: number;
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  loadError: string | null;
  startDate: string | null;
  endDate: string | null;
  periodAllTime: boolean;
  canExport: boolean;
};

const KIND_LABEL: Record<StockOutTransaction['kind'], string> = {
  SOLD: 'Sold',
  WRITE_OFF: 'Written off',
  REVERSAL: 'Delivery reversed',
};

const KIND_BADGE: Record<StockOutTransaction['kind'], string> = {
  SOLD: 'badge-success',
  WRITE_OFF: 'badge-danger',
  REVERSAL: 'badge-warning',
};

const columns: CompactTableColumn<StockOutTransaction>[] = [
  {
    key: 'when',
    header: 'Date',
    nowrap: true,
    cellClassName: 'text-app-fg-muted',
    render: (t) => formatOrderTimestamp(t.createdAt),
  },
  {
    key: 'type',
    header: 'Type',
    nowrap: true,
    render: (t) => <span className={`badge ${KIND_BADGE[t.kind]}`}>{KIND_LABEL[t.kind]}</span>,
  },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    nowrap: true,
    cellClassName: (t) =>
      `tabular-nums font-semibold ${t.quantity < 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}`,
    render: (t) => (t.quantity < 0 ? `−${fmt(Math.abs(t.quantity))}` : fmt(t.quantity)),
  },
  {
    key: 'order',
    header: 'Order',
    nowrap: true,
    render: (t) =>
      t.orderId ? (
        <OrderIdBadge
          id={t.orderId}
          orderNumber={t.orderNumber}
          branchId={t.orderBranchId}
          linkTo={`/admin/orders/${t.orderId}`}
          hideCopy
        />
      ) : (
        <span className="text-app-fg-muted">None</span>
      ),
  },
  {
    key: 'location',
    header: 'Location',
    hideOnMobile: true,
    cellClassName: 'text-app-fg-muted',
    render: (t) => t.locationName ?? 'Unknown',
  },
  {
    key: 'by',
    header: 'By',
    hideOnMobile: true,
    cellClassName: 'text-app-fg-muted',
    render: (t) => t.actorName ?? 'System',
  },
];

export function StockOutProductPage(data: StockOutProductPageData) {
  const { productId, productName, summary, startDate, endDate, periodAllTime, canExport } = data;
  const [exportOpen, setExportOpen] = useState(false);

  const period = periodLabel(startDate, endDate);
  const backTo = `/admin/inventory/stock-out${stockOutPeriodSearch(startDate, endDate, periodAllTime)}`;
  const totalQty = summary?.totalQty ?? 0;
  const reconciled = data.transactionsTotalQty === totalQty;

  const exportButton = (mobile = false, onDone?: () => void) =>
    canExport ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={mobile ? 'h-12 w-full justify-center' : undefined}
        onClick={() => { onDone?.(); setExportOpen(true); }}
      >
        Export transactions
      </Button>
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={productName}
        backTo={backTo}
        mobileInlineActions
        description={`Stock out: ${period}`}
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
                {exportButton()}
              </>
            }
            sheet={
              ({ closeSheet }) => (
                <>
                  {exportButton(true, closeSheet)}
                  <Link to={backTo} className="btn-secondary btn-sm w-full justify-center">
                    Back to stock out
                  </Link>
                </>
              )
            }
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
          { label: 'Total out', value: fmt(totalQty), valueClassName: 'text-app-fg', title: period },
          {
            label: 'Sold',
            value: fmt(summary?.soldQty ?? 0),
            valueClassName: 'text-success-600 dark:text-success-400',
            title: 'Delivered units, minus reversed deliveries',
          },
          {
            label: 'Written off',
            value: fmt(summary?.writtenOffQty ?? 0),
            valueClassName: 'text-danger-600 dark:text-danger-400',
          },
          { label: 'Transactions', value: fmt(data.total), valueClassName: 'text-app-fg' },
        ]}
      />

      {data.loadError ? (
        <EmptyState variant="card" title="Could not load transactions" description={data.loadError} />
      ) : (
        <Card variant="default" padding="md">
          <CardBody className="p-0">
            {data.transactions.length === 0 ? (
              <div className="p-4">
                <EmptyState variant="card" title="No stock out in this period" description="Pick a wider date range." />
              </div>
            ) : (
              <CompactTable<StockOutTransaction> columns={columns} rows={data.transactions} rowKey={(t) => t.id} />
            )}
          </CardBody>

          {data.total > 0 ? (
            <div className="border-t border-app-border p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className={`text-sm ${reconciled ? 'text-app-fg-muted' : 'text-danger-600 dark:text-danger-400'}`}>
                {`Showing ${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)} of ${fmt(data.total)} ${data.total === 1 ? 'transaction' : 'transactions'}, ${fmt(data.transactionsTotalQty)} units`}
                {reconciled ? '' : `. The total shows ${fmt(totalQty)}: refresh the page.`}
              </p>
              {data.totalPages > 1 ? (
                <Pagination page={data.page} totalPages={data.totalPages} pageSize={data.limit} pageSizeParam="perPage" />
              ) : null}
            </div>
          ) : null}
        </Card>
      )}

      {exportOpen && (
        <ExportModal
          open
          onClose={() => setExportOpen(false)}
          config={EXPORT_CONFIGS.stock_out_transactions}
          initialDateRange={{ startDate, endDate }}
          initialFilters={{ productId }}
          defaultIncludeCurrentFilters
        />
      )}
    </div>
  );
}
