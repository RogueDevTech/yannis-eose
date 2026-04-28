import { useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { CashRemittanceCreateModal } from './CashRemittanceCreateModal';

export interface DeliveryRemittanceListItem {
  id: string;
  logisticsLocationId: string;
  sentBy: string;
  receiptUrls: string[];
  status: string;
  sentAt: string;
  locationName: string | null;
  orderCount: number;
  disputeReason?: string | null;
  outcomeStatus?: 'APPROVED' | 'DISPUTED' | 'SENT' | string;
  outcomeAmount?: string;
  outcomeOrderCount?: number;
  outcomeReason?: string | null;
}

export interface DeliveryRemittanceDetail extends DeliveryRemittanceListItem {
  orders: Array<{
    id: string;
    customerName: string;
    totalAmount: string | null;
    deliveredAt: string | null;
  }>;
}

export interface DeliveryRemittanceSummary {
  totalRemitted: string;
  pendingAmount: string;
  receivedAmount: string;
  disputedAmount: string;
  totalCount: string;
  pendingCount: string;
  receivedCount: string;
  disputedCount: string;
}

export interface DeliveryRemittancesPageProps {
  remittances: DeliveryRemittanceListItem[];
  pagination: { total: number; totalPages: number; page: number };
  locations: Array<{ id: string; name: string }>;
  filters: {
    status: string;
    location: string;
    /** Phase 18 — sent-by filter (accountant who recorded the remittance). */
    sentBy: string;
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
  };
  userMap: Record<string, string>;
  /** Phase 18 — accountants (Finance / admin / Finance hat) for the Sent by select. */
  sentByOptions: Array<{ id: string; name: string }>;
  /** Phase 18 — delivered orders not yet on a remittance, for the Create modal. */
  eligibleOrders: import('./CashRemittanceCreateModal').EligibleOrder[];
  /** Phase 18 — total eligible on server (modal shows this when only a slice is fetched). */
  eligibleTotal: number;
  summary: DeliveryRemittanceSummary;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'SENT', label: 'Pending' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'DISPUTED', label: 'Disputed' },
] as const;

export function DeliveryRemittancesPage({
  remittances,
  pagination,
  locations,
  filters,
  userMap,
  sentByOptions,
  eligibleOrders,
  eligibleTotal,
  summary,
}: DeliveryRemittancesPageProps) {
  const [, setSearchParams] = useSearchParams();
  const isLoaderRefetchBusy = useLoaderRefetchBusy();
  const { totalPages, page } = pagination;
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleStatusChange = (status: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!status) next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const handleLocationChange = (locationId: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!locationId) next.delete('location');
      else next.set('location', locationId);
      return next;
    });
  };

  const handleSentByChange = (userId: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!userId) next.delete('sentBy');
      else next.set('sentBy', userId);
      return next;
    });
  };

  const hasFilters = !!filters.status || !!filters.location || !!filters.sentBy;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash Remittances"
        description="Record cash received against delivered orders. Marking a remittance Received closes out its orders (DELIVERED → COMPLETED)."
        actions={
          <>
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime}
            />
            <PageRefreshButton />
            <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
              Generate report
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowCreateModal(true)}
              disabled={eligibleTotal === 0}
              title={eligibleTotal === 0 ? 'No delivered orders awaiting remittance' : undefined}
            >
              + Create cash remittance
            </Button>
          </>
        }
      />

      <CashRemittanceCreateModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        eligibleOrders={eligibleOrders}
        eligibleTotal={eligibleTotal}
        actionUrl="/admin/finance/delivery-remittances"
      />
      <LocalExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Delivery Remittances"
        description="Choose format and columns for delivery remittances export."
        filenamePrefix="cash-remittances"
        rows={remittances.map((r) => ({
          id: r.id,
          location: r.locationName ?? '',
          sentBy: userMap[r.sentBy] ?? 'Unknown user',
          orderCount: r.orderCount,
          status:
            STATUS_LABEL[r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)] ??
            (r.outcomeStatus ?? r.status),
          sentAt: new Date(r.sentAt).toLocaleString(),
        }))}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'location', label: 'Location' },
          { key: 'sentBy', label: 'Sent by' },
          { key: 'orderCount', label: 'Orders' },
          { key: 'status', label: 'Status' },
          { key: 'sentAt', label: 'Sent at' },
        ]}
        defaultColumns={['id', 'location', 'sentBy', 'orderCount', 'status', 'sentAt']}
      />

      <OverviewStatStrip
        items={[
          {
            label: 'Total remitted',
            value: <NairaPrice amount={summary.totalRemitted} />,
            valueClassName: 'text-app-fg tabular-nums',
            title: `${Number(summary.totalCount)} remittance(s)`,
          },
          {
            label: 'Pending',
            value: <NairaPrice amount={summary.pendingAmount} />,
            valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums',
            title: `${Number(summary.pendingCount)} remittance(s)`,
          },
          {
            label: 'Received',
            value: <NairaPrice amount={summary.receivedAmount} />,
            valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
            title: `${Number(summary.receivedCount)} remittance(s)`,
          },
          {
            label: 'Disputed',
            value: <NairaPrice amount={summary.disputedAmount} />,
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: `${Number(summary.disputedCount)} remittance(s)`,
          },
        ]}
      />

      <div className="card space-y-3">
        <Tabs
          value={filters.status}
          onChange={handleStatusChange}
          tabs={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
          variant="pill"
        />
        <div className="flex flex-wrap gap-2">
          <SearchableSelect
            id="delivery-remittance-location-filter"
            value={filters.location}
            onChange={handleLocationChange}
            wrapperClassName="w-full sm:w-52"
            placeholder="All locations"
            searchPlaceholder="Search locations..."
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((loc) => ({ value: loc.id, label: loc.name })),
            ]}
          />
          {/* Phase 18 — Sent-by filter (accountant who recorded the remittance). */}
          <SearchableSelect
            id="delivery-remittance-sent-by-filter"
            value={filters.sentBy}
            onChange={handleSentByChange}
            wrapperClassName="w-full sm:w-56"
            placeholder="Sent by anyone"
            searchPlaceholder="Search accountants..."
            options={[
              { value: '', label: 'Sent by anyone' },
              ...sentByOptions.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </div>
      </div>

      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
      <div className="card p-0">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">ID</th>
                <th className="table-header">Location</th>
                <th className="table-header">Sent by</th>
                <th className="table-header text-right">Orders</th>
                <th className="table-header">Status</th>
                <th className="table-header">Sent at</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {remittances.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="table-cell">
                    <span className="font-mono text-xs text-app-fg-muted">{r.id.slice(0, 8)}…</span>
                  </td>
                  <td className="table-cell text-sm text-app-fg">{r.locationName ?? '—'}</td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {userMap[r.sentBy] ?? 'Unknown user'}
                  </td>
                  <td className="table-cell text-right">{r.orderCount}</td>
                  <td className="table-cell">
                    <StatusBadge
                      status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)}
                      label={STATUS_LABEL[r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)]}
                    />
                  </td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {new Date(r.sentAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="table-cell">
                    <Link
                      to={`/admin/finance/delivery-remittances/${r.id}`}
                      className="btn-secondary btn-sm inline-flex"
                    >
                      {(r.outcomeStatus ?? r.status) === 'SENT' ? 'Review' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 px-1">
          {remittances.map((r) => (
            <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-app-fg-muted">{r.id.slice(0, 8)}…</span>
                <StatusBadge
                  status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)}
                  label={STATUS_LABEL[r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)]}
                />
              </div>
              <div className="text-sm text-app-fg-muted">
                {r.locationName ?? '—'} · {r.orderCount} order(s) · {userMap[r.sentBy] ?? 'Unknown'}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>
                  {new Date(r.sentAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <Link
                  to={`/admin/finance/delivery-remittances/${r.id}`}
                  className="btn-secondary btn-sm inline-flex"
                >
                  {(r.outcomeStatus ?? r.status) === 'SENT' ? 'Review' : 'View'}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {remittances.length === 0 && (
          <EmptyState
            title="No cash remittances found"
            description={
              hasFilters
                ? 'Try adjusting your filters'
                : '3PL locations will appear here once they submit remittances'
            }
          />
        )}
      </div>
      </TableLoadingOverlay>

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} pageParam="page" />}
    </div>
  );
}
