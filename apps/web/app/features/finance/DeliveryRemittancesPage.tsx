import { useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
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
  locationProviderName: string | null;
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
  locations: Array<{ id: string; name: string; providerName?: string | null }>;
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
  /** Phase 21 — true when the actor can record a new cash remittance. */
  canCreateRemittance: boolean;
  /** Phase 21 — true when the actor can mark a remittance Received (cascades DELIVERED→COMPLETED). */
  canMarkReceived: boolean;
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
  canCreateRemittance,
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

  const remittanceToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (filters.status) n += 1;
    if (filters.location) n += 1;
    if (filters.sentBy) n += 1;
    return n;
  }, [filters.status, filters.location, filters.sentBy]);

  const remittanceColumns: CompactTableColumn<DeliveryRemittanceListItem>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'ID',
        tight: true,
        render: (r) => <span className="font-mono text-xs text-app-fg-muted">{r.id.slice(0, 8)}…</span>,
      },
      {
        key: 'location',
        header: 'Location',
        render: (r) => (
          <span className="text-sm text-app-fg">
            {r.locationName
              ? r.locationProviderName
                ? `${r.locationName} — ${r.locationProviderName}`
                : r.locationName
              : '—'}
          </span>
        ),
      },
      {
        key: 'sentBy',
        header: 'Sent by',
        render: (r) => <span className="text-sm text-app-fg-muted">{userMap[r.sentBy] ?? 'Unknown user'}</span>,
      },
      {
        key: 'orderCount',
        header: 'Orders',
        align: 'right',
        render: (r) => <span className="tabular-nums">{r.orderCount}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <StatusBadge
            status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)}
            label={STATUS_LABEL[r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status)]}
          />
        ),
      },
      {
        key: 'sentAt',
        header: 'Sent at',
        nowrap: true,
        render: (r) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(r.sentAt).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (r) => (
          <CompactTableActionButton to={`/admin/finance/delivery-remittances/${r.id}`}>
            {(r.outcomeStatus ?? r.status) === 'SENT' ? 'Review' : 'View'}
          </CompactTableActionButton>
        ),
      },
    ],
    [userMap],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash Remittances"
        description="Record cash received against delivered orders. Marking a remittance Received closes out its orders (DELIVERED → COMPLETED)."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cash remittances tools"
            sheetSubtitle={<span>Date range, export, and create</span>}
            triggerAriaLabel="Cash remittances toolbar and date range"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
                <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                  Generate report
                </Button>
                {canCreateRemittance && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowCreateModal(true)}
                    disabled={eligibleTotal === 0}
                    title={eligibleTotal === 0 ? 'No delivered orders awaiting remittance' : undefined}
                  >
                    + Create cash remittance
                  </Button>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowExportModal(true);
                  }}
                >
                  Generate report
                </Button>
                {canCreateRemittance && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    disabled={eligibleTotal === 0}
                    title={eligibleTotal === 0 ? 'No delivered orders awaiting remittance' : undefined}
                    onClick={() => {
                      closeSheet();
                      setShowCreateModal(true);
                    }}
                  >
                    + Create cash remittance
                  </Button>
                )}
              </>
            )}
          />
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

      <div className="card p-0 overflow-hidden">
        <ToolbarFiltersCollapsible
          className="!border-0"
          badgeCount={remittanceToolbarFilterBadge}
          sheetSubtitle={<span>Location and sent-by apply immediately</span>}
          searchRow={
            <div className="min-w-0 shrink-0 md:min-w-0 md:flex-1">
              <Tabs
                value={filters.status}
                onChange={handleStatusChange}
                tabs={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
                variant="pill"
              />
            </div>
          }
          desktopInlineFilters={
            <>
              <SearchableSelect
                id="delivery-remittance-location-filter"
                value={filters.location}
                onChange={handleLocationChange}
                wrapperClassName="w-full min-w-0 sm:w-52"
                placeholder="All locations"
                searchPlaceholder="Search locations..."
                options={[
                  { value: '', label: 'All locations' },
                  ...locations.map((loc) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                  })),
                ]}
              />
              <SearchableSelect
                id="delivery-remittance-sent-by-filter"
                value={filters.sentBy}
                onChange={handleSentByChange}
                wrapperClassName="w-full min-w-0 sm:w-56"
                placeholder="Sent by anyone"
                searchPlaceholder="Search accountants..."
                options={[
                  { value: '', label: 'Sent by anyone' },
                  ...sentByOptions.map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Location</span>
                <SearchableSelect
                  id="delivery-remittance-location-filter-sheet"
                  value={filters.location}
                  onChange={handleLocationChange}
                  wrapperClassName="w-full"
                  placeholder="All locations"
                  searchPlaceholder="Search locations..."
                  options={[
                    { value: '', label: 'All locations' },
                    ...locations.map((loc) => ({
                      value: loc.id,
                      label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                    })),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Sent by</span>
                <SearchableSelect
                  id="delivery-remittance-sent-by-filter-sheet"
                  value={filters.sentBy}
                  onChange={handleSentByChange}
                  wrapperClassName="w-full"
                  placeholder="Sent by anyone"
                  searchPlaceholder="Search accountants..."
                  options={[
                    { value: '', label: 'Sent by anyone' },
                    ...sentByOptions.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
              </div>
            </>
          }
        />
      </div>

      <CompactTable<DeliveryRemittanceListItem>
        columns={remittanceColumns}
        rows={remittances}
        rowKey={(r) => r.id}
        loading={isLoaderRefetchBusy}
        loadingVariant="overlay"
        emptyTitle="No cash remittances found"
        emptyDescription={
          hasFilters
            ? 'Try adjusting your filters'
            : 'Cash remittances will appear here once Finance records them'
        }
        pagination={{
          page,
          totalPages,
          pageParam: 'page',
        }}
      />
    </div>
  );
}
