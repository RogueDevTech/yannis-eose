import { Suspense, useState } from 'react';
import { Await } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { DeferredError } from '~/components/ui/deferred-section';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { Modal } from '~/components/ui/modal';
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
  originalOrderId: string | null;
  originalMediaBuyerName: string | null;
}

export interface CrossFunnelStats {
  totalAttempts: number;
  uniqueCustomers: number;
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
  filters: { startDate: string; endDate: string; periodAllTime: boolean; productId: string };
}

function formatDate(iso: string): string {
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

/** Single compact stat tile — mirrors `MarketingTeamCompactStat` for visual parity with the team peek. */
function CrossFunnelCompactStat({
  label,
  value,
  valueClassName = 'text-app-fg',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-app-border bg-app-hover/40 px-2.5 py-2">
      <span className={['block text-sm font-semibold leading-tight tabular-nums truncate', valueClassName].filter(Boolean).join(' ')}>
        {value}
      </span>
      <span className="mt-1 block text-micro font-medium uppercase tracking-[0.14em] text-app-fg-muted">
        {label}
      </span>
    </div>
  );
}

/**
 * Cross-funnel attempt peek card — opened by tapping a row on mobile.
 * Header (customer + when) → 4 stat tiles → "View winning order" link.
 * Pass `embedded` when rendering inside the modal so the outer `card` chrome
 * isn't doubled with the modal surface.
 */
function CrossFunnelAttemptCard({ row, embedded }: { row: CrossFunnelAttemptRow; embedded?: boolean }) {
  return (
    <div className={embedded ? 'space-y-3' : 'card space-y-3'}>
      <div className="flex items-start gap-3">
        <CompactUserAvatar name={row.customerName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-app-fg">{row.customerName}</p>
          <p className="text-mini font-medium uppercase tracking-[0.14em] text-app-fg-muted">
            Cross-funnel · {formatDate(row.attemptedAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CrossFunnelCompactStat
          label="Product"
          value={row.productName ?? '—'}
          valueClassName="text-brand-600 dark:text-brand-400"
        />
        <CrossFunnelCompactStat label="Phone" value={row.customerPhone ?? '—'} />
        <CrossFunnelCompactStat label="Your funnel" value={row.mediaBuyerName ?? '—'} />
        <CrossFunnelCompactStat
          label="Credited to"
          value={row.originalMediaBuyerName ?? <em className="not-italic text-app-fg-muted">unknown</em>}
        />
      </div>

      {row.originalOrderId ? (
        <div className="border-t border-app-border pt-3">
          <CompactTableActionButton
            to={orderDetailHref('/admin/orders', row.originalOrderId, 'marketing')}
            className="w-full justify-center"
            tone="brand"
          >
            View winning order
          </CompactTableActionButton>
        </div>
      ) : null}
    </div>
  );
}

export function MarketingCrossFunnelPage({ list, secondary }: PageProps) {
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [previewAttempt, setPreviewAttempt] = useState<CrossFunnelAttemptRow | null>(null);

  const columns: CompactTableColumn<CrossFunnelAttemptRow>[] = [
    {
      key: 'attemptedAt',
      header: 'When',
      render: (row) => <span className="text-app-fg-muted text-sm">{formatDate(row.attemptedAt)}</span>,
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (row) => (
        <div>
          <span className="font-medium">{row.customerName}</span>
          {row.customerPhone && (
            <span className="block text-xs text-app-fg-muted">{row.customerPhone}</span>
          )}
        </div>
      ),
    },
    {
      key: 'productName',
      header: 'Product',
      render: (row) => row.productName ?? '—',
    },
    {
      key: 'mediaBuyerName',
      header: 'Your funnel',
      render: (row) => <span className="text-app-fg-muted text-sm">{row.mediaBuyerName ?? '—'}</span>,
    },
    {
      key: 'originalMediaBuyerName',
      header: 'Credited to',
      render: (row) => (
        <span className="text-app-fg-muted text-sm">
          {row.originalMediaBuyerName ?? <em>unknown</em>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cross-funnel attempts"
        mobileInlineActions
        description="Review duplicate funnel attempts."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cross-funnel tools"
            sheetSubtitle={<span>Date range and refresh</span>}
            triggerAriaLabel="Cross-funnel toolbar and date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar chrome="pill" />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow />

      <Suspense
        fallback={
          <>
            <OverviewStatStrip
              mobileGrid
              items={[
                { label: 'Attempts', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Unique customers', value: <StatValuePulse className="min-w-[2rem]" /> },
              ]}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-app-border bg-app-elevated p-3.5 shadow-sm animate-pulse" aria-hidden>
                  <span className="block h-7 w-10 rounded bg-app-hover" />
                  <span className="mt-2 block h-3 w-20 rounded bg-app-hover" />
                </div>
              ))}
            </div>
          </>
        }
      >
        <Await resolve={secondary} errorElement={<DeferredError />}>
          {(stats) => (
            <>
              <OverviewStatStrip
                mobileGrid
                items={[
                  { label: 'Attempts', value: stats.totalAttempts },
                  { label: 'Unique customers', value: stats.uniqueCustomers },
                ]}
              />

              {stats.perProduct.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {stats.perProduct.map((p) => (
                    <div
                      key={p.productId}
                      className="rounded-xl border border-app-border bg-app-elevated p-3.5 shadow-sm"
                    >
                      <span className="block text-2xl font-bold tabular-nums text-app-fg leading-tight">
                        {p.attempts}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-app-fg-muted truncate">
                        {p.productName ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Await>
      </Suspense>

      <Card>
        <CardHeader title="Attempts" />
        <CardBody className="p-0">
          <CompactTable<CrossFunnelAttemptRow>
            columns={columns}
            rows={list.rows}
            rowKey={(r) => r.id}
            loading={isLoaderRefetchBusy}
            loadingVariant="overlay"
            withCard={false}
            emptyTitle="No cross-funnel attempts in this period"
            emptyDescription="When a customer fills your form for a product they've already ordered through someone else's funnel within 24 hours, the attempt shows up here."
            pagination={
              list.totalPages >= 1
                ? { page: list.page, totalPages: list.totalPages }
                : undefined
            }
            renderMobileCard={(row) => (
              <button
                type="button"
                onClick={() => setPreviewAttempt(row)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
              >
                {/* Row 1: customer + attempted-at */}
                <div className="flex items-center gap-2.5">
                  <CompactUserAvatar name={row.customerName} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">
                    {row.customerName}
                  </span>
                  <span className="shrink-0 text-mini text-app-fg-muted tabular-nums">
                    {formatDate(row.attemptedAt)}
                  </span>
                </div>
                {/* Row 2: phone · product · credited-to MB */}
                <div className="flex items-center gap-2 text-xs text-app-fg-muted pl-[calc(1.75rem+0.625rem)]">
                  {row.customerPhone && (
                    <>
                      <span className="shrink-0">{row.customerPhone}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="truncate">{row.productName ?? '—'}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    credited to {row.originalMediaBuyerName ?? 'unknown'}
                  </span>
                </div>
              </button>
            )}
          />
        </CardBody>
      </Card>

      {/* Mobile peek modal — full attempt detail + "view winning order" link.
          Mirrors MarketingTeamPage / Sales peek pattern for visual consistency. */}
      <Modal
        open={!!previewAttempt}
        onClose={() => setPreviewAttempt(null)}
        maxWidth="max-w-sm"
        contentClassName="p-4"
      >
        {previewAttempt && <CrossFunnelAttemptCard row={previewAttempt} embedded />}
      </Modal>
    </div>
  );
}
