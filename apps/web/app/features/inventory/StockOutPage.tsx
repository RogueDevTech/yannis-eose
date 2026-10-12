import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { formatOrderTimestamp } from '~/lib/format-date';

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

type StockOutTransaction = {
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

type TransactionsPage = {
  transactions: StockOutTransaction[];
  totalQty: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
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

const TRANSACTIONS_PAGE_SIZE = 50;

const fmt = (n: number) => n.toLocaleString('en-NG');

function periodLabel(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return 'All time';
  if (startDate === endDate) return startDate ?? '';
  return `${startDate ?? 'Start'} to ${endDate ?? 'today'}`;
}

/** Same date filters the page uses; sent to the API and to exports. */
function periodFilters(startDate: string | null, endDate: string | null): Record<string, string> {
  return {
    ...(startDate ? { startDate: startDate.slice(0, 10) } : {}),
    ...(endDate ? { endDate: endDate.slice(0, 10) } : {}),
  };
}

function summaryColumns(onView: (row: StockOutProductRow) => void): CompactTableColumn<StockOutProductRow>[] {
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
      render: (r) => <CompactTableActionButton onClick={() => onView(r)}>View</CompactTableActionButton>,
    },
  ];
}

export function StockOutPage({ summary, loadError, startDate, endDate, periodAllTime, canExport }: StockOutPageData) {
  const [selected, setSelected] = useState<StockOutProductRow | null>(null);
  const [exportKey, setExportKey] = useState<'stock_out_summary' | 'stock_out_transactions' | null>(null);
  const [exportProductId, setExportProductId] = useState<string | null>(null);

  const period = periodLabel(startDate, endDate);

  const openExport = (key: 'stock_out_summary' | 'stock_out_transactions', productId: string | null = null) => {
    setExportProductId(productId);
    setExportKey(key);
  };

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
          columns={summaryColumns(setSelected)}
          emptyTitle="No stock out in this period"
          emptyDescription="Pick a wider date range."
          renderMobileCard={(r) => (
            <button
              type="button"
              onClick={() => setSelected(r)}
              className="flex w-full flex-col gap-1 py-3 px-1 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-app-fg truncate">{r.productName}</span>
                <span className="font-semibold tabular-nums text-app-fg shrink-0">{fmt(r.totalQty)}</span>
              </span>
              <span className="text-xs text-app-fg-muted tabular-nums">
                Sold {fmt(r.soldQty)} · Written off {fmt(r.writtenOffQty)} · {fmt(r.transactionCount)} txns
              </span>
            </button>
          )}
        />
      )}

      <StockOutTransactionsModal
        key={selected?.productId ?? 'none'}
        product={selected}
        startDate={startDate}
        endDate={endDate}
        period={period}
        canExport={canExport}
        onExport={(productId) => openExport('stock_out_transactions', productId)}
        onClose={() => setSelected(null)}
      />

      {exportKey && (
        <ExportModal
          open
          onClose={() => setExportKey(null)}
          config={EXPORT_CONFIGS[exportKey]}
          initialDateRange={{ startDate, endDate }}
          {...(exportProductId
            ? { initialFilters: { productId: exportProductId }, defaultIncludeCurrentFilters: true }
            : {})}
        />
      )}
    </div>
  );
}

function StockOutTransactionsModal({
  product,
  startDate,
  endDate,
  period,
  canExport,
  onExport,
  onClose,
}: {
  product: StockOutProductRow | null;
  startDate: string | null;
  endDate: string | null;
  period: string;
  canExport: boolean;
  onExport: (productId: string) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TransactionsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const productId = product?.productId ?? null;

  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const input = encodeURIComponent(JSON.stringify({
      ...periodFilters(startDate, endDate),
      productId,
      page,
      limit: TRANSACTIONS_PAGE_SIZE,
    }));
    fetch(`${getBrowserApiBaseUrl()}/trpc/inventory.stockOutTransactions?input=${input}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load transactions.');
        const body = (await res.json()) as { result?: { data?: TransactionsPage } };
        if (!controller.signal.aborted) setData(body.result?.data ?? null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load transactions.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productId, startDate, endDate, page]);

  const columns = useMemo<CompactTableColumn<StockOutTransaction>[]>(() => [
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
      cellClassName: (t) => `tabular-nums font-semibold ${t.quantity < 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}`,
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
  ], []);

  if (!product) return null;

  const pagination = data?.pagination;
  const reconciled = data ? data.totalQty === product.totalQty : null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-3xl" backdropBlur aria-labelledby="stock-out-transactions-title">
      <div className="space-y-4 px-4 pt-5 md:px-6 md:pt-6 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="stock-out-transactions-title" className="text-base font-semibold text-app-fg truncate">
              {product.productName}
            </h2>
            <p className="text-xs text-app-fg-muted mt-0.5">{period}</p>
          </div>
          <span className="text-2xl font-semibold tabular-nums text-app-fg shrink-0">
            {fmt(product.totalQty)}
            <span className="text-sm font-normal text-app-fg-muted ml-1">out</span>
          </span>
        </div>

        {error ? (
          <EmptyState variant="card" title="Could not load transactions" description={error} />
        ) : (
          <CompactTable<StockOutTransaction>
            rows={data?.transactions ?? []}
            rowKey={(t) => t.id}
            columns={columns}
            loading={loading}
            loadingVariant={data ? 'overlay' : 'skeleton'}
            emptyTitle="No transactions"
            pagination={
              pagination && pagination.totalPages > 1
                ? { page: pagination.page, totalPages: pagination.totalPages, onPageChange: setPage }
                : undefined
            }
          />
        )}

        {data && (
          <p className={`text-xs ${reconciled ? 'text-app-fg-muted' : 'text-danger-600 dark:text-danger-400'}`}>
            {fmt(data.pagination.total)} transactions add up to {fmt(data.totalQty)} units
            {reconciled ? ', matching the summary.' : `. The summary shows ${fmt(product.totalQty)}: refresh the page.`}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          {canExport && (
            <Button type="button" variant="secondary" size="sm" onClick={() => onExport(product.productId)}>
              Export
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
