import { Suspense } from 'react';
import { Await, Link } from '@remix-run/react';
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
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';

export interface CrossFunnelAttemptRow {
  id: string;
  customerName: string;
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

export function MarketingCrossFunnelPage({ list, secondary }: PageProps) {
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;

  const columns: CompactTableColumn<CrossFunnelAttemptRow>[] = [
    {
      key: 'attemptedAt',
      header: 'When',
      render: (row) => <span className="text-app-fg-muted text-sm">{formatDate(row.attemptedAt)}</span>,
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (row) => <span className="font-medium">{row.customerName}</span>,
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
                <div className="flex w-fit shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar />
                </div>
                <PageRefreshButton />
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
                {
                  label: 'Top product',
                  value: <StatValuePulse className="min-w-[10rem] max-w-[14rem]" />,
                  plainValue: true,
                },
              ]}
            />
            <Card>
              <CardHeader title="By product" />
              <CardBody>
                <ul className="divide-y divide-app-border">
                  {[1, 2, 3].map((i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-2">
                      <span className="h-4 flex-1 max-w-[14rem] rounded bg-app-hover animate-pulse" aria-hidden />
                      <span className="h-4 w-8 rounded bg-app-hover animate-pulse" aria-hidden />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
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
                  {
                    label: 'Top product',
                    value: stats.perProduct[0]?.productName ?? '—',
                    plainValue: true,
                    valueClassName: 'text-base font-semibold mt-1 truncate max-w-[14rem]',
                  },
                ]}
              />

              {stats.perProduct.length > 0 && (
                <Card>
                  <CardHeader title="By product" />
                  <CardBody>
                    <ul className="divide-y divide-app-border">
                      {stats.perProduct.map((p) => (
                        <li key={p.productId} className="flex items-center justify-between py-2">
                          <span>{p.productName ?? '—'}</span>
                          <span className="font-semibold">{p.attempts}</span>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
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
          />
        </CardBody>
      </Card>

      <p className="text-xs text-app-fg-muted">
        These rows are visible only to you and your Head of Marketing. CS does not see them.{' '}
        <Link to="/admin/marketing/overview" className="underline">
          Back to marketing overview
        </Link>
        .
      </p>
    </div>
  );
}
