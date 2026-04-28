import { Link } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Pagination } from '~/components/ui/pagination';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DataTable, type TableColumn } from '~/components/ui/data-table';

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
  stats: CrossFunnelStats;
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

export function MarketingCrossFunnelPage({ list, stats }: PageProps) {
  const isLoaderRefetchBusy = useLoaderRefetchBusy();
  const statItems = [
    { label: 'Attempts', value: stats.totalAttempts },
    { label: 'Unique customers', value: stats.uniqueCustomers },
    {
      label: 'Top product',
      value: stats.perProduct[0]?.productName ?? '—',
      plainValue: true,
      valueClassName: 'text-base font-semibold mt-1 truncate max-w-[14rem]',
    },
  ];

  const columns: TableColumn<CrossFunnelAttemptRow>[] = [
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
        description="Customers who tried to order through your funnel but already submitted via another Media Buyer's funnel within the dedup window. These are NOT orders — they don't count in your CPA, ROAS, or any pipeline. Use this as a signal that your funnel is generating real interest."
      />

      <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0 w-fit">
        <DateFilterBar />
      </div>

      <OverviewStatStrip items={statItems} />

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

      <Card>
        <CardHeader title="Attempts" />
        <CardBody className="p-0">
          {list.rows.length === 0 ? (
            <EmptyState
              variant="card"
              title="No cross-funnel attempts in this period"
              description="When a customer fills your form for a product they've already ordered through someone else's funnel within 6 hours, the attempt shows up here."
            />
          ) : (
            <DataTable<CrossFunnelAttemptRow>
              columns={columns}
              data={list.rows}
              keyField="id"
              loading={isLoaderRefetchBusy}
              loadingVariant="overlay"
            />
          )}
        </CardBody>
      </Card>

      {list.totalPages > 1 && (
        <Pagination page={list.page} totalPages={list.totalPages} />
      )}

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
