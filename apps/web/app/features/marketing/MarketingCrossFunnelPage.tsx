import { Suspense, useState, useMemo } from 'react';
import { Await, Link, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { clipName } from '~/lib/clip-name';
import { DeferredError } from '~/components/ui/deferred-section';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import {
  CompactTable,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { orderDetailHref } from '~/lib/order-detail-return';

export interface CrossFunnelAttemptRow {
  id: string;
  customerName: string;
  customerPhone: string | null;
  attemptedAt: string;
  productId: string;
  productName: string | null;
  mediaBuyerId: string;
  mediaBuyerName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  originalOrderId: string | null;
  originalMediaBuyerId: string | null;
  originalMediaBuyerName: string | null;
  originalCampaignId: string | null;
  originalCampaignName: string | null;
  originalOrderStatus: string | null;
  originalOrderAmount: string | null;
  originalOrderNumber: number | null;
  originalOrderCreatedAt: string | null;
}

export interface CrossFunnelStats {
  totalAttempts: number;
  uniqueCustomers: number;
  resubmissions: number;
  sameMb: number;
  crossFunnel: number;
  perProduct: Array<{ productId: string; productName: string | null; attempts: number }>;
}

interface PageProps {
  list: {
    rows: CrossFunnelAttemptRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  secondary: Promise<CrossFunnelStats>;
  filters: { startDate: string; endDate: string; periodAllTime: boolean; productId: string; campaignId: string; mediaBuyerId: string; search: string; duplicateType: string };
  productsForFilter?: Array<{ id: string; name: string }>;
  campaignsForFilter?: Array<{ id: string; name: string }>;
  mediaBuyersForFilter?: Array<{ id: string; name: string }>;
  showMbFilter?: boolean;
  canExport?: boolean;
}

type DuplicateKind = 'resubmission' | 'same-mb' | 'cross-funnel';

function getDuplicateKind(row: CrossFunnelAttemptRow): DuplicateKind {
  // Campaign match takes priority: same form = resubmission, regardless of MB attribution.
  // Forms are 1:1 with MBs, so a same-campaign-different-MB is a data edge case, not cross-funnel.
  if (row.campaignId && row.originalCampaignId && row.campaignId === row.originalCampaignId) return 'resubmission';
  if (!row.originalMediaBuyerId || row.mediaBuyerId !== row.originalMediaBuyerId) return 'cross-funnel';
  return 'same-mb';
}

const DUPLICATE_TAG: Record<DuplicateKind, { label: string; className: string }> = {
  resubmission: {
    label: 'Resubmission',
    className: 'border-app-border bg-app-hover text-app-fg-muted dark:border-app-border dark:bg-app-hover',
  },
  'same-mb': {
    label: 'Same MB',
    className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  'cross-funnel': {
    label: 'Cross-funnel',
    className: 'border-danger-300 bg-danger-50 text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  },
};

function DuplicateTag({ row }: { row: CrossFunnelAttemptRow }) {
  const kind = getDuplicateKind(row);
  const tag = DUPLICATE_TAG[kind];
  return (
    <span className={`ml-1.5 inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide ${tag.className}`}>
      {tag.label}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function MarketingCrossFunnelPage({
  list, secondary, filters,
  productsForFilter = [], campaignsForFilter = [], mediaBuyersForFilter = [],
  showMbFilter = false,
  canExport = false,
}: PageProps) {
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(filters.search || '');
  const [compareRow, setCompareRow] = useState<CrossFunnelAttemptRow | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      const trimmed = searchQuery.trim();
      if (trimmed) next.set('search', trimmed);
      else next.delete('search');
      next.set('page', '1');
      return next;
    });
  };

  const activeType = searchParams.get('duplicateType') || '';

  const handleTypeFilter = (type: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (type && type !== 'all') next.set('duplicateType', type);
      else next.delete('duplicateType');
      next.set('page', '1');
      return next;
    });
  };

  const filterBadgeCount =
    (searchParams.get('mediaBuyerId') ? 1 : 0) +
    (searchParams.get('productId') ? 1 : 0) +
    (searchParams.get('campaignId') ? 1 : 0) +
    (searchQuery ? 1 : 0);

  const columns: CompactTableColumn<CrossFunnelAttemptRow>[] = useMemo(() => [
    {
      key: 'orderId',
      header: 'Order ID',
      render: (row) =>
        row.originalOrderId && row.originalOrderNumber ? (
          <OrderIdBadge
            id={row.originalOrderId}
            orderNumber={row.originalOrderNumber}
            linkTo={orderDetailHref('/admin/orders', row.originalOrderId, 'marketing')}
          />
        ) : (
          <span className="text-app-fg-muted text-xs">—</span>
        ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <span className="font-medium text-app-fg" title={row.customerName ?? undefined}>
          {clipName(row.customerName)}
          {/^test([^a-zA-Z]|$)/i.test(row.customerName?.trim() ?? '') && (
            <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
          )}
          <DuplicateTag row={row} />
        </span>
      ),
    },
    {
      key: 'mediaBuyer',
      header: 'Media buyer',
      render: (row) =>
        row.mediaBuyerId ? (
          <Link
            to={`/hr/users/${row.mediaBuyerId}`}
            className="text-brand-500 hover:text-brand-600 font-medium hover:underline"
          >
            {row.mediaBuyerName ?? '—'}
          </Link>
        ) : (
          <span className="text-app-fg-muted">—</span>
        ),
    },
    {
      key: 'product',
      header: 'Product',
      render: (row) => <span className="text-sm text-app-fg">{row.productName ?? '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      headerClassName: 'text-right',
      render: (row) => (
        <span className="font-medium">
          {row.originalOrderAmount ? (
            <NairaPrice amount={Number(row.originalOrderAmount)} />
          ) : (
            <span className="text-app-fg-muted">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.originalOrderStatus ? (
          <OrderStatusBadge status={row.originalOrderStatus} />
        ) : (
          <span className="text-app-fg-muted">—</span>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      render: (row) => (
        <span className="text-xs text-app-fg-muted whitespace-nowrap">
          {formatTimestamp(row.attemptedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      mobileShowLabel: false,
      render: (row) => (
        <TableRowActionsSheet
          ariaLabel={`Actions for ${row.customerName}`}
          sheetTitle={row.customerName}
          actions={[
            {
              key: 'compare',
              kind: 'button',
              label: 'Compare',
              onClick: () => setCompareRow(row),
            },
            ...(row.originalOrderId
              ? [{
                  key: 'view-order',
                  kind: 'link' as const,
                  label: 'Original Order',
                  to: orderDetailHref('/admin/orders', row.originalOrderId, 'marketing'),
                }]
              : []),
          ]}
        />
      ),
    },
  ], []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Duplicate Attempts"
        mobileInlineActions
        description="All duplicate order submissions across your funnels."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Duplicate attempts toolbar"
            filtersBadgeCount={filterBadgeCount}
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar startDate={filters.startDate} endDate={filters.endDate} periodAllTime={filters.periodAllTime} chrome="pill" />
                {canExport && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                    Generate report
                  </Button>
                )}
              </>
            }
            filters={
              <>
                {showMbFilter && mediaBuyersForFilter.length > 0 && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="cf-mobile-buyer"
                      value={searchParams.get('mediaBuyerId') || 'ALL'}
                      onChange={(v) => {
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.set('page', '1');
                          if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                          else next.delete('mediaBuyerId');
                          return next;
                        });
                      }}
                      options={[
                        { value: 'ALL', label: 'All media buyers' },
                        ...mediaBuyersForFilter.map((u) => ({ value: u.id, label: u.name })),
                      ]}
                      placeholder="All media buyers"
                      searchPlaceholder="Search buyers…"
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                    />
                  </div>
                )}
                {productsForFilter.length > 0 && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="cf-mobile-product"
                      value={searchParams.get('productId') || 'ALL'}
                      onChange={(v) => {
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.set('page', '1');
                          if (v && v !== 'ALL') next.set('productId', v);
                          else next.delete('productId');
                          return next;
                        });
                      }}
                      options={[
                        { value: 'ALL', label: 'All products' },
                        ...productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      placeholder="All products"
                      searchPlaceholder="Search products…"
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                    />
                  </div>
                )}
                {campaignsForFilter.length > 0 && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="cf-mobile-form"
                      value={searchParams.get('campaignId') || 'ALL'}
                      onChange={(v) => {
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.set('page', '1');
                          if (v && v !== 'ALL') next.set('campaignId', v);
                          else next.delete('campaignId');
                          return next;
                        });
                      }}
                      options={[
                        { value: 'ALL', label: 'All forms' },
                        ...campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      placeholder="All forms"
                      searchPlaceholder="Search forms…"
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                    />
                  </div>
                )}
              </>
            }
            sheet={canExport ? ({ closeSheet }) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-12 w-full justify-center"
                onClick={() => {
                  closeSheet();
                  setShowExportModal(true);
                }}
              >
                Generate report
              </Button>
            ) : undefined}
          />
        }
      />

      {canExport && (
        <ExportModal
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          config={EXPORT_CONFIGS.cross_funnel}
          initialFilters={{
            ...(filters.periodAllTime
              ? { periodAllTime: true as const }
              : filters.startDate && filters.endDate
                ? { startDate: filters.startDate, endDate: filters.endDate }
                : {}),
            ...(filters.productId ? { productId: filters.productId } : {}),
            ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
            ...(filters.mediaBuyerId ? { mediaBuyerId: filters.mediaBuyerId } : {}),
            ...(filters.search ? { search: filters.search } : {}),
            ...(filters.duplicateType ? { duplicateType: filters.duplicateType } : {}),
          }}
          picklists={{
            mediaBuyers: mediaBuyersForFilter,
            products: productsForFilter,
            campaigns: campaignsForFilter,
          }}
        />
      )}

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      {/* Stats */}
      <Suspense
        fallback={
          <OverviewStatStrip
            mobileGrid
            items={[
              { label: 'Total', value: <StatValuePulse className="min-w-[2rem]" /> },
              { label: 'Resubmissions', value: <StatValuePulse className="min-w-[2rem]" /> },
              { label: 'Same MB', value: <StatValuePulse className="min-w-[2rem]" /> },
              { label: 'Cross-funnel', value: <StatValuePulse className="min-w-[2rem]" /> },
              { label: 'Unique customers', value: <StatValuePulse className="min-w-[2rem]" /> },
            ]}
          />
        }
      >
        <Await resolve={secondary} errorElement={<DeferredError />}>
          {(stats) => (
            <OverviewStatStrip
              mobileGrid
              items={[
                { label: 'Total', value: stats.totalAttempts, onClick: () => handleTypeFilter('all'), active: !activeType },
                { label: 'Resubmissions', value: stats.resubmissions, valueClassName: 'text-app-fg', onClick: () => handleTypeFilter('resubmission'), active: activeType === 'resubmission' },
                { label: 'Same MB', value: stats.sameMb, valueClassName: 'text-amber-600 dark:text-amber-400', onClick: () => handleTypeFilter('same-mb'), active: activeType === 'same-mb' },
                { label: 'Cross-funnel', value: stats.crossFunnel, valueClassName: 'text-danger-600 dark:text-danger-400', onClick: () => handleTypeFilter('cross-funnel'), active: activeType === 'cross-funnel' },
                { label: 'Unique customers', value: stats.uniqueCustomers },
              ]}
            />
          )}
        </Await>
      </Suspense>

      {/* Search + Filters — same pattern as MarketingOrdersPage */}
      <ToolbarFiltersCollapsible
        hideMobileSheet
        badgeCount={filterBadgeCount}
        searchRow={
          <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 gap-2">
            <SearchInput
              placeholder="Search by name, phone, or product..."
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              withSubmitButton
              wrapperClassName="min-w-0 flex-1"
            />
          </form>
        }
        desktopInlineFilters={
          <>
            {showMbFilter && mediaBuyersForFilter.length > 0 ? (
              <div className="relative">
                {!!searchParams.get('mediaBuyerId') && (
                  <FilterDismiss
                    onClear={() => {
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.delete('mediaBuyerId');
                        next.set('page', '1');
                        return next;
                      });
                    }}
                  />
                )}
                <SearchableSelect
                  id="cf-filter-buyer"
                  value={searchParams.get('mediaBuyerId') || 'ALL'}
                  onChange={(v) => {
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                      else next.delete('mediaBuyerId');
                      return next;
                    });
                  }}
                  options={[
                    { value: 'ALL', label: 'All media buyers' },
                    ...mediaBuyersForFilter.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  wrapperClassName="w-full min-w-0 sm:w-56"
                  placeholder="All media buyers"
                  searchPlaceholder="Search buyers…"
                />
              </div>
            ) : null}
            {productsForFilter.length > 0 ? (
              <div className="relative">
                {!!searchParams.get('productId') && (
                  <FilterDismiss
                    onClear={() => {
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.delete('productId');
                        next.set('page', '1');
                        return next;
                      });
                    }}
                  />
                )}
                <SearchableSelect
                  id="cf-filter-product"
                  value={searchParams.get('productId') || 'ALL'}
                  onChange={(v) => {
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v && v !== 'ALL') next.set('productId', v);
                      else next.delete('productId');
                      return next;
                    });
                  }}
                  options={[
                    { value: 'ALL', label: 'All products' },
                    ...productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                  placeholder="All products"
                  searchPlaceholder="Search products…"
                />
              </div>
            ) : null}
            {campaignsForFilter.length > 0 ? (
              <div className="relative">
                {!!searchParams.get('campaignId') && (
                  <FilterDismiss
                    onClear={() => {
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.delete('campaignId');
                        next.set('page', '1');
                        return next;
                      });
                    }}
                  />
                )}
                <SearchableSelect
                  id="cf-filter-form"
                  value={searchParams.get('campaignId') || 'ALL'}
                  onChange={(v) => {
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v && v !== 'ALL') next.set('campaignId', v);
                      else next.delete('campaignId');
                      return next;
                    });
                  }}
                  options={[
                    { value: 'ALL', label: 'All forms' },
                    ...campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                  placeholder="All forms"
                  searchPlaceholder="Search forms…"
                />
              </div>
            ) : null}
          </>
        }
        sheetFilterBody={null}
      />

      {/* Table */}
      <CompactTable<CrossFunnelAttemptRow>
        columns={columns}
        rows={list.rows}
        rowKey={(r) => r.id}
        loading={isLoaderRefetchBusy}
        loadingVariant="overlay"
        emptyTitle="No duplicate attempts"
        emptyDescription="When a customer submits an order for a product they've already ordered within the last 7 days, it appears here."
        pagination={
          list.totalPages >= 1
            ? { page: list.page, totalPages: list.totalPages }
            : undefined
        }
        renderMobileCard={(row) => (
          <button
            type="button"
            onClick={() => setCompareRow(row)}
            className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-app-fg" title={row.customerName ?? undefined}>
                {clipName(row.customerName)}
                <DuplicateTag row={row} />
              </span>
              {row.originalOrderNumber && (
                <OrderIdBadge id={row.originalOrderId ?? ''} orderNumber={row.originalOrderNumber} textClassName="text-sm font-medium text-app-fg" />
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {row.originalOrderStatus ? (
                  <OrderStatusBadge status={row.originalOrderStatus} />
                ) : (
                  <span className="text-xs text-app-fg-muted">—</span>
                )}
                <span className="text-xs text-app-fg-muted truncate">{row.productName ?? '—'}</span>
              </div>
              <span className="whitespace-nowrap text-xs text-app-fg-muted">{formatShortDate(row.attemptedAt)}</span>
            </div>
          </button>
        )}
      />

      {/* Compare modal */}
      <DuplicateCompareOverlay row={compareRow} onClose={() => setCompareRow(null)} />
    </div>
  );
}

// ── Compare modal — row-by-row diff table ──────────────────────────────────────

function CompareRow({
  label,
  left,
  right,
  highlight,
}: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  highlight?: boolean;
}) {
  const match = typeof left === 'string' && typeof right === 'string' && left === right;
  return (
    <>
      {/* Desktop: 3-column row */}
      <tr className={`hidden md:table-row ${highlight ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
        <td className="py-2 pr-3 text-xs font-medium uppercase tracking-wider text-app-fg-muted whitespace-nowrap align-top">
          {label}
        </td>
        <td className={`py-2 px-3 text-sm align-top border-l border-app-border ${match ? 'text-app-fg' : 'text-danger-600 dark:text-danger-400 font-medium'}`}>
          {left}
        </td>
        <td className={`py-2 pl-3 text-sm align-top border-l border-app-border ${match ? 'text-app-fg' : 'text-success-600 dark:text-success-400 font-medium'}`}>
          {right}
        </td>
      </tr>
      {/* Mobile: column — label, then Old : value, New : value */}
      <tr className="md:hidden border-b border-app-border/50">
        <td colSpan={3} className="py-2.5 px-3">
          <div className="text-micro font-bold uppercase tracking-wider text-app-fg-muted mb-1.5">{label}</div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-micro font-semibold uppercase text-danger-500 dark:text-danger-400 w-12 shrink-0">New</span>
              <span className={`text-sm ${match ? 'text-app-fg' : 'text-danger-600 dark:text-danger-400 font-medium'}`}>{left}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-micro font-semibold uppercase text-success-500 dark:text-success-400 w-12 shrink-0">Old</span>
              <span className={`text-sm ${match ? 'text-app-fg' : 'text-success-600 dark:text-success-400 font-medium'}`}>{right}</span>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function DuplicateCompareOverlay({
  row,
  onClose,
}: {
  row: CrossFunnelAttemptRow | null;
  onClose: () => void;
}) {
  if (!row) return null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-3xl"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
      aria-labelledby="cf-compare-title"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cf-compare-title" className="text-lg font-semibold text-app-fg">
            Duplicate Comparison
          </h2>
          <p className="text-xs mt-0.5 text-warning-700 dark:text-warning-400">
            {(() => {
              const kind = getDuplicateKind(row);
              switch (kind) {
                case 'resubmission': return 'Repeat submission — same customer, same form';
                case 'same-mb': return 'Same customer ordered through another form by the same Media Buyer';
                case 'cross-funnel': return 'Same customer already ordered through a different Media Buyer';
              }
            })()}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body — row-by-row comparison table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Desktop header */}
            <tr className="hidden md:table-row border-b border-app-border bg-app-hover/50">
              <th className="py-2.5 px-5 text-left text-micro font-bold uppercase tracking-wider text-app-fg-muted w-[100px]" />
              <th className="py-2.5 px-3 text-left text-micro font-bold uppercase tracking-wider text-danger-600 dark:text-danger-400 border-l border-app-border">
                Duplicate attempt
              </th>
              <th className="py-2.5 pl-3 pr-5 text-left text-micro font-bold uppercase tracking-wider text-success-600 dark:text-success-400 border-l border-app-border">
                Original order
              </th>
            </tr>
            {/* Mobile header — hidden; labels are inline per row */}
            <tr className="md:hidden sr-only"><th colSpan={3} /></tr>
          </thead>
          <tbody className="divide-y divide-app-border/50">
            {row.originalOrderId && row.originalOrderNumber && (
              <CompareRow
                label="Order"
                left="—"
                right={
                  <OrderIdBadge
                    id={row.originalOrderId}
                    orderNumber={row.originalOrderNumber}
                    length={8}
                    ellipsis="…"
                    linkTo={`/admin/orders/${row.originalOrderId}`}
                    newTab
                    textClassName="font-mono text-xs text-brand-600 dark:text-brand-400 hover:underline"
                    className="inline-flex"
                  />
                }
              />
            )}
            <CompareRow
              label="Status"
              left={
                <span className="inline-flex items-center rounded-full border border-warning-300 bg-warning-50 px-1.5 py-0.5 text-micro font-semibold uppercase text-warning-700 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
                  Duplicate
                </span>
              }
              right={row.originalOrderStatus ? <OrderStatusBadge status={row.originalOrderStatus} /> : '—'}
            />
            <CompareRow label="Customer" left={row.customerName} right={row.customerName} />
            {row.customerPhone && (
              <CompareRow label="Phone" left={row.customerPhone} right={row.customerPhone} />
            )}
            <CompareRow label="Product" left={row.productName ?? '—'} right={row.productName ?? '—'} />
            <CompareRow
              label="Total"
              left={row.originalOrderAmount ? <NairaPrice amount={Number(row.originalOrderAmount)} /> : '—'}
              right={row.originalOrderAmount ? <NairaPrice amount={Number(row.originalOrderAmount)} /> : '—'}
            />
            <CompareRow
              label="Date"
              left={formatTimestamp(row.attemptedAt)}
              right={row.originalOrderCreatedAt ? formatTimestamp(row.originalOrderCreatedAt) : '—'}
              highlight
            />
            <CompareRow
              label="Media buyer"
              left={row.mediaBuyerName ?? '—'}
              right={row.originalMediaBuyerName ?? '—'}
            />
            <CompareRow
              label="Form"
              left={row.campaignName ?? '—'}
              right={row.originalCampaignName ?? row.campaignName ?? '—'}
            />
          </tbody>
        </table>

        <div className="px-5 py-4 space-y-3">
          <InlineNotification
            variant="info"
            message={(() => {
              const kind = getDuplicateKind(row);
              switch (kind) {
                case 'resubmission':
                  return 'Same customer re-submitted the same form. This is a repeat submission — the customer likely clicked submit more than once or revisited the form.';
                case 'same-mb':
                  return 'Same customer ordered the same product through a different form by the same Media Buyer. Only one order per customer per product per week is allowed.';
                case 'cross-funnel':
                  return 'Same customer already ordered this product through a different Media Buyer\'s form. The original order takes priority — duplicate was blocked to prevent double-selling.';
              }
            })()}
          />

          {row.originalOrderId && (
            <p className="text-xs text-app-fg-muted">
              <Link
                to={`/admin/orders/${row.originalOrderId}`}
                className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
                onClick={onClose}
              >
                Original Order →
              </Link>
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-app-border flex items-center justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
