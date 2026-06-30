import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateInvoicePdf } from '~/lib/invoice-pdf';
import { InvoicePreviewModal } from '~/components/ui/invoice-preview-modal';
import type { OrderInvoice } from '~/features/orders/types';
import { useFetcher, useLocation, useNavigation, useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Tabs } from '~/components/ui/tabs';
import { FilterPills } from '~/components/ui/filter-pills';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { SearchInput } from '~/components/ui/search-input';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useNavigate } from '@remix-run/react';
import type { EligibleOrder } from './CashRemittanceCreateModal';

export interface DeliveryRemittanceListItem {
  id: string;
  logisticsLocationId: string;
  sentBy: string;
  /** Resolved on the server — avoids "Unknown user" when the accountant is outside the first page of `users.list`. */
  sentByName?: string | null;
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
  notes?: string | null;
  receivedAt?: string | null;
  receivedBy?: string | null;
  receivedByName?: string | null;
  commitmentFee?: string | null;
  posFee?: string | null;
  failedDeliveryCost?: string | null;
  orders: Array<{
    id: string;
    customerName: string;
    totalAmount: string | null;
    deliveryFee: string | null;
    deliveredAt: string | null;
    status: string;
    invoice: OrderInvoice | null;
  }>;
}

export interface DeliveryRemittanceSummary {
  /** Delivered orders not yet on a cash remittance batch (same scope as Awaiting tab, ignores batch date filter). */
  awaitingAmount: string;
  awaitingCount: string;
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
  pagination: { total: number; totalPages: number; page: number; pageSize: number; pageSizeOptions?: number[] };
  locations: Array<{ id: string; name: string; providerName?: string | null }>;
  filters: {
    status: string;
    location: string;
    /** Phase 18 — sent-by filter (accountant who recorded the remittance). */
    sentBy: string;
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    /** Server-side search for the Awaiting remittance tab (`q` query param). */
    eligibleQ: string;
  };
  userMap: Record<string, string>;
  /** Phase 18 — accountants (Finance / admin / Finance hat) for the Sent by select. */
  sentByOptions: Array<{ id: string; name: string }>;
  /** Delivered orders not yet on a remittance — current page (server-paginated). */
  eligibleOrders: EligibleOrder[];
  eligiblePagination: { total: number; totalPages: number; page: number; pageSize: number };
  /** Phase 18 — total eligible on server (modal shows this when only a slice is fetched). */
  eligibleTotal: number;
  summary: DeliveryRemittanceSummary;
  /** Phase 21 — true when the actor can record a new cash remittance. */
  canCreateRemittance: boolean;
  /** Phase 21 — true when the actor can mark a remittance Received (cascades DELIVERED→REMITTED). */
  canMarkReceived: boolean;
}

function formatDeliveredAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    // Date + time (12-hour) — finance ops want to see WHEN a delivery landed
    // not just the day, especially when reconciling same-day batches.
    return new Date(iso).toLocaleString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function eligibleLineAmount(o: EligibleOrder): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

export function DeliveryRemittancesPage({
  remittances,
  pagination,
  locations,
  filters,
  userMap,
  sentByOptions,
  eligibleOrders,
  eligiblePagination,
  eligibleTotal,
  summary,
  canCreateRemittance,
}: DeliveryRemittancesPageProps) {
  const [, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  const { totalPages, page, pageSize, pageSizeOptions } = pagination;
  const {
    totalPages: eligibleTotalPages,
    page: eligiblePage,
    pageSize: eligiblePageSize,
  } = eligiblePagination;
  const navigateTo = useNavigate();
  const [showExportModal, setShowExportModal] = useState(false);
  const [eligibleInvoicePreview, setEligibleInvoicePreview] = useState<OrderInvoice | null>(null);
  const generateInvoiceFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [generatingOrderId, setGeneratingOrderId] = useState<string | null>(null);
  const isGeneratingInvoice = generateInvoiceFetcher.state !== 'idle';
  // Clear generating state + reload on success
  useEffect(() => {
    if (generateInvoiceFetcher.state === 'idle' && generateInvoiceFetcher.data?.success) {
      setGeneratingOrderId(null);
      primeSamePathRefetch();
      window.location.reload();
    }
  }, [generateInvoiceFetcher.state, generateInvoiceFetcher.data, primeSamePathRefetch]);
  const [eligibleSelectedIds, setEligibleSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedEligibleById, setSelectedEligibleById] = useState<Map<string, EligibleOrder>>(
    () => new Map(),
  );
  const [eligibleSearchDraft, setEligibleSearchDraft] = useState(filters.eligibleQ);
  useEffect(() => {
    setEligibleSearchDraft(filters.eligibleQ);
  }, [filters.eligibleQ]);

  /**
   * Default: Awaiting remittance; `?tab=remittances` is the batch list.
   * While the loader refetches after a tab click, read `tab` from the **pending** URL so the
   * underline switches immediately; tables keep using stale rows + `loading` overlay until idle.
   */
  const tabSearch =
    navigation.state === 'loading' &&
    navigation.location &&
    navigation.location.pathname === location.pathname
      ? navigation.location.search
      : location.search;
  const viewTab = useMemo(() => {
    const p = new URLSearchParams(tabSearch);
    return p.get('tab') === 'remittances' ? 'remittances' : 'eligible';
  }, [tabSearch]);

  /**
   * Same trick as `viewTab` — read the status pill value from the *pending*
   * URL during loader revalidation, so the pill snaps to the clicked value
   * on the same React tick instead of waiting for the server response.
   * CEO directive: no sluggish UI feedback.
   */
  const pendingStatus = useMemo(() => {
    const p = new URLSearchParams(tabSearch);
    return p.get('status') ?? '';
  }, [tabSearch]);

  const setViewTab = useCallback(
    (tab: 'remittances' | 'eligible') => {
      primeSamePathRefetch();
      setSearchParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set('page', '1');
          if (tab === 'remittances') next.set('tab', 'remittances');
          else next.delete('tab');
          return next;
        },
        { replace: true },
      );
    },
    [primeSamePathRefetch, setSearchParams],
  );

  const handleLocationChange = (locationId: string) => {
    primeSamePathRefetch();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('eligiblePage', '1');
      if (!locationId || locationId === 'ALL') next.delete('location');
      else next.set('location', locationId);
      return next;
    });
  };

  const handleEligibleSearchChange = (value: string) => {
    const trimmed = value.trim();
    primeSamePathRefetch();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('eligiblePage', '1');
      if (!trimmed) next.delete('q');
      else next.set('q', trimmed);
      return next;
    });
  };

  const handleSentByChange = (userId: string) => {
    primeSamePathRefetch();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!userId) next.delete('sentBy');
      else next.set('sentBy', userId);
      return next;
    });
  };

  const handleStatusChange = (status: string) => {
    // Paint the table overlay on the SAME frame as the click — without this,
    // `isLoaderRefetchBusy` only goes true once Remix has scheduled the
    // navigation, which can look unresponsive on fast networks.
    primeSamePathRefetch();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!status) next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const hasFilters = !!filters.location || !!filters.sentBy;
  const hasEligibleFilters = !!filters.location || !!filters.eligibleQ;

  /** So the detail page can link “Back” / breadcrumb to the same list URL (tab, page, filters). */
  const remittanceDetailLinkState = useMemo(
    () => ({ from: `${location.pathname}${location.search}` }),
    [location.pathname, location.search],
  );

  const remittanceToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (filters.location) n += 1;
    if (filters.sentBy) n += 1;
    return n;
  }, [filters.location, filters.sentBy]);

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
        render: (r) => (
          <span className="text-sm text-app-fg-muted">
            {r.sentByName?.trim() || userMap[r.sentBy] || `${r.sentBy.slice(0, 8)}…`}
          </span>
        ),
      },
      {
        key: 'orderCount',
        header: 'Orders',
        align: 'right',
        render: (r) => <span className="tabular-nums">{r.orderCount}</span>,
      },
      {
        key: 'amount',
        header: 'Batch total',
        align: 'right',
        nowrap: true,
        render: (r) => (
          <NairaPrice
            amount={Number(r.outcomeAmount ?? 0)}
            className="text-sm font-medium text-app-fg tabular-nums"
          />
        ),
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
          <CompactTableActionButton
            to={`/admin/finance/delivery-remittances/${r.id}`}
            state={remittanceDetailLinkState}
          >
            {(r.outcomeStatus ?? r.status) === 'SENT' ? 'Review' : 'View'}
          </CompactTableActionButton>
        ),
      },
    ],
    [userMap, remittanceDetailLinkState],
  );

  const remittanceSelectedOrders = useMemo(() => {
    return [...eligibleSelectedIds]
      .map((id) => selectedEligibleById.get(id) ?? eligibleOrders.find((o) => o.id === id))
      .filter((o): o is EligibleOrder => !!o);
  }, [eligibleSelectedIds, selectedEligibleById, eligibleOrders]);

  const remittanceSelectionComplete =
    eligibleSelectedIds.size > 0 && remittanceSelectedOrders.length === eligibleSelectedIds.size;

  const eligibleMultiLocation =
    new Set(remittanceSelectedOrders.map((o) => o.logisticsLocationId ?? '')).size > 1;

  const eligibleSelectedTotal = useMemo(
    () => remittanceSelectedOrders.reduce((acc, o) => acc + eligibleLineAmount(o), 0),
    [remittanceSelectedOrders],
  );

  const eligibleColumns: CompactTableColumn<EligibleOrder>[] = useMemo(
    () => [
      {
        key: 'invoiceRef',
        header: 'Invoice',
        render: (o) =>
          o.invoice ? (
            // Clickable invoice reference — opens the same preview modal as the
            // explicit "View Invoice" button, just discoverable inline. Brand
            // colour signals clickability the way standard hyperlinks do.
            <button
              type="button"
              onClick={() => o.invoice && setEligibleInvoicePreview(o.invoice)}
              className="font-mono text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 rounded-sm"
            >
              {o.invoice.referenceFormatted}
            </button>
          ) : (
            <span className="text-xs text-app-fg-muted">No invoice</span>
          ),
      },
      {
        key: 'billTo',
        header: 'Bill to',
        render: (o) => (
          <span className="text-sm text-app-fg truncate max-w-[12rem] inline-block align-bottom">
            {o.invoice?.recipientInfo?.name ?? o.customerName}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (o) => {
          const raw = o.invoice?.totalAmount ?? o.totalAmount;
          return raw != null && raw !== '' ? <NairaPrice amount={Number(raw)} /> : '—';
        },
      },
      {
        key: 'location',
        header: 'Location',
        render: (o) =>
          o.logisticsLocationName
            ? o.logisticsLocationProviderName
              ? `${o.logisticsLocationName} — ${o.logisticsLocationProviderName}`
              : o.logisticsLocationName
            : '—',
      },
      {
        key: 'delivered',
        header: 'Delivered',
        nowrap: true,
        render: (o) => <span className="text-app-fg-muted">{formatDeliveredAt(o.deliveredAt)}</span>,
      },
      {
        key: 'invoiceActions',
        header: '',
        align: 'right',
        nowrap: true,
        render: (o) => (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <TableActionButton
              variant="neutral"
              onClick={() => navigateTo(`/admin/orders/${o.id}`)}
              title="View order"
            >
              Order
            </TableActionButton>
            {o.invoice ? (
              <>
                <TableActionButton
                  variant="primary"
                  title="View invoice"
                  onClick={() => o.invoice && setEligibleInvoicePreview(o.invoice)}
                >
                  Invoice
                </TableActionButton>
                <TableActionButton
                  variant="neutral"
                  title="Download"
                  onClick={() => {
                    if (o.invoice) void generateInvoicePdf(o.invoice);
                  }}
                >
                  Download
                </TableActionButton>
              </>
            ) : (
              <generateInvoiceFetcher.Form method="post">
                <input type="hidden" name="intent" value="generateInvoice" />
                <input type="hidden" name="orderId" value={o.id} />
                <TableActionButton
                  variant="primary"
                  type="submit"
                  disabled={isGeneratingInvoice && generatingOrderId === o.id}
                  onClick={() => setGeneratingOrderId(o.id)}
                >
                  {isGeneratingInvoice && generatingOrderId === o.id ? 'Generating…' : 'Generate Invoice'}
                </TableActionButton>
              </generateInvoiceFetcher.Form>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generateInvoiceFetcher, isGeneratingInvoice, generatingOrderId, navigateTo],
  );

  const onEligibleToggle = useCallback((id: string, checked: boolean) => {
    setEligibleSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setSelectedEligibleById((prev) => {
      const next = new Map(prev);
      if (checked) {
        const row = eligibleOrders.find((o) => o.id === id);
        if (row) next.set(id, row);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, [eligibleOrders]);

  const onEligibleToggleAll = useCallback(
    (selectAll: boolean) => {
      if (!selectAll) {
        setEligibleSelectedIds(new Set());
        setSelectedEligibleById(new Map());
        return;
      }
      setEligibleSelectedIds(new Set(eligibleOrders.map((o) => o.id)));
      setSelectedEligibleById(new Map(eligibleOrders.map((o) => [o.id, o])));
    },
    [eligibleOrders],
  );

  const openCreateFromEligibleTab = useCallback(() => {
    if (
      eligibleSelectedIds.size === 0 ||
      eligibleMultiLocation ||
      !remittanceSelectionComplete
    ) {
      return;
    }
    const ids = [...eligibleSelectedIds].join(',');
    navigateTo(`/admin/finance/delivery-remittances/create?orders=${ids}`);
  }, [eligibleSelectedIds, eligibleMultiLocation, remittanceSelectionComplete, navigateTo]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash Remittances"
        mobileInlineActions
        description="Review and record cash remittances."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Cash remittances toolbar and date range"
            filtersBadgeCount={viewTab === 'remittances' ? remittanceToolbarFilterBadge : 0}
            filters={
              <>
                {viewTab === 'remittances' && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="delivery-remittance-status-filter-kebab"
                      value={pendingStatus}
                      onChange={handleStatusChange}
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                      placeholder="All statuses"
                      options={[
                        { value: '', label: 'All statuses' },
                        { value: 'SENT', label: 'Pending' },
                        { value: 'RECEIVED', label: 'Received' },
                        { value: 'DISPUTED', label: 'Disputed' },
                      ]}
                    />
                  </div>
                )}
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  {!!filters.location && (
                    <FilterDismiss onClear={() => handleLocationChange('')} />
                  )}
                  <SearchableSelect
                    id="delivery-remittance-location-filter-kebab"
                    value={filters.location}
                    onChange={handleLocationChange}
                    triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                    wrapperClassName="w-full"
                    placeholder="All locations"
                    searchPlaceholder="Search locations..."
                    options={[
                      { value: '', label: 'All locations' },
                      ...locations.map((loc) => ({
                        value: loc.id,
                        label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                      })),
                    ]}
                  />
                </div>
                {viewTab === 'remittances' && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    {!!filters.sentBy && (
                      <FilterDismiss onClear={() => handleSentByChange('')} />
                    )}
                    <SearchableSelect
                      id="delivery-remittance-sent-by-filter-kebab"
                      value={filters.sentBy}
                      onChange={handleSentByChange}
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                      placeholder="Sent by anyone"
                      searchPlaceholder="Search accountants..."
                      options={[
                        { value: '', label: 'Sent by anyone' },
                        ...sentByOptions.map((u) => ({ value: u.id, label: u.name })),
                      ]}
                    />
                  </div>
                )}
              </>
            }
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime} chrome="pill" />
                <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                  Generate report
                </Button>
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <Button
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
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <InvoicePreviewModal
        invoice={eligibleInvoicePreview}
        onClose={() => setEligibleInvoicePreview(null)}
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
          sentBy: r.sentByName?.trim() || userMap[r.sentBy] || r.sentBy,
          orderCount: r.orderCount,
          batchTotal: Number(r.outcomeAmount ?? 0),
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
          { key: 'batchTotal', label: 'Batch total (₦)' },
          { key: 'status', label: 'Status' },
          { key: 'sentAt', label: 'Sent at' },
        ]}
        defaultColumns={['id', 'location', 'sentBy', 'orderCount', 'batchTotal', 'status', 'sentAt']}
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          {
            label: `Total Invoices (${Number(summary.awaitingCount) + Number(summary.receivedCount) + Number(summary.pendingCount) + Number(summary.disputedCount)})`,
            value: <NairaPrice amount={Number(summary.awaitingAmount) + Number(summary.receivedAmount) + Number(summary.pendingAmount) + Number(summary.disputedAmount)} />,
            valueClassName: 'text-app-fg tabular-nums',
          },
          {
            label: `Awaiting (${Number(summary.awaitingCount)})`,
            value: <NairaPrice amount={summary.awaitingAmount} />,
            valueClassName: 'text-info-600 dark:text-info-400 tabular-nums',
          },
          {
            label: `Received (${Number(summary.receivedCount)})`,
            value: <NairaPrice amount={summary.receivedAmount} />,
            valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
          },
          {
            label: `Pending (${Number(summary.pendingCount)})`,
            value: <NairaPrice amount={summary.pendingAmount} />,
            valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums',
          },
          {
            label: `Disputed (${Number(summary.disputedCount)})`,
            value: <NairaPrice amount={summary.disputedAmount} />,
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
          },
        ]}
      />

      <Tabs
        variant="underline"
        value={viewTab}
        onChange={(v) => setViewTab(v as 'remittances' | 'eligible')}
        tabs={[
          {
            value: 'eligible',
            label: 'Awaiting remittance',
            badge:
              eligibleTotal > 0 ? (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border border-app-border bg-app-hover px-1.5 text-micro font-semibold tabular-nums text-app-fg-muted">
                  {eligibleTotal}
                </span>
              ) : null,
          },
          { value: 'remittances', label: `Remitted (${Number(summary.totalCount)})` },
        ]}
      />

      {viewTab === 'remittances' && (
        <>
          <div className="list-panel">
            <ToolbarFiltersCollapsible
              className="!border-0"
              hideMobileSheet
              badgeCount={remittanceToolbarFilterBadge}
              desktopInlineFilters={
                <>
                  <div className="relative">
                    {!!filters.location && (
                      <FilterDismiss onClear={() => handleLocationChange('')} />
                    )}
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
                          label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                        })),
                      ]}
                    />
                  </div>
                  <div className="relative">
                    {!!filters.sentBy && (
                      <FilterDismiss onClear={() => handleSentByChange('')} />
                    )}
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
                  </div>
                </>
              }
              sheetFilterBody={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Location</span>
                    <div className="relative">
                      {!!filters.location && (
                        <FilterDismiss onClear={() => handleLocationChange('')} />
                      )}
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
                            label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Sent by</span>
                    <div className="relative">
                      {!!filters.sentBy && (
                        <FilterDismiss onClear={() => handleSentByChange('')} />
                      )}
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
                  </div>
                </>
              }
            />
          </div>
          {/* Status filter pills — narrow the Remitted list to a single
              lifecycle stage. Counts come from the summary (status-agnostic),
              so they don't reshuffle as the user clicks between pills. */}
          <FilterPills
            size="sm"
            value={pendingStatus}
            onChange={handleStatusChange}
            options={[
              { value: '', label: 'All', count: Number(summary.totalCount) },
              { value: 'SENT', label: 'Pending', count: Number(summary.pendingCount), dotColor: 'bg-warning-500' },
              { value: 'RECEIVED', label: 'Received', count: Number(summary.receivedCount), dotColor: 'bg-success-500' },
              { value: 'DISPUTED', label: 'Disputed', count: Number(summary.disputedCount), dotColor: 'bg-danger-500' },
            ]}
          />

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
              pageSize,
              pageSizeOptions,
              showWhenSinglePage: true,
              wrapperClassName: 'mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
              controlsClassName: 'sm:justify-end',
              summary: (
                <span className="text-app-fg-muted">
                  {pagination.total === 0
                    ? `0 remittances`
                    : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pagination.total)} of ${pagination.total}`}
                </span>
              ),
            }}
            renderMobileCard={(r) => {
              const status =
                r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.status);
              return (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-app-fg truncate">
                        {r.locationName
                          ? r.locationProviderName
                            ? `${r.locationName} — ${r.locationProviderName}`
                            : r.locationName
                          : '—'}
                      </p>
                      <p className="text-xs text-app-fg-muted truncate">
                        {r.orderCount} order{r.orderCount === 1 ? '' : 's'} ·{' '}
                        {r.sentByName?.trim() || userMap[r.sentBy] || `${r.sentBy.slice(0, 8)}…`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <NairaPrice
                        amount={Number(r.outcomeAmount ?? 0)}
                        className="text-sm font-semibold text-app-fg tabular-nums"
                      />
                      <p className="text-mini text-app-fg-muted">
                        {new Date(r.sentAt).toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={status} label={STATUS_LABEL[status]} />
                    <CompactTableActionButton
                      to={`/admin/finance/delivery-remittances/${r.id}`}
                      state={remittanceDetailLinkState}
                    >
                      {(r.outcomeStatus ?? r.status) === 'SENT' ? 'Review' : 'View'}
                    </CompactTableActionButton>
                  </div>
                </div>
              );
            }}
          />
        </>
      )}

      {viewTab === 'eligible' && (
        <div className="space-y-3">
          {eligibleTotal > eligibleOrders.length ? (
            <p className="text-xs text-warning-600 dark:text-warning-400">
              Showing {eligibleOrders.length} of {eligibleTotal} matching orders — refine search or page.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <form
              className="min-w-0"
              onSubmit={(e) => {
                e.preventDefault();
                handleEligibleSearchChange(eligibleSearchDraft);
              }}
            >
              <SearchInput
                value={eligibleSearchDraft}
                onChange={(v) => {
                  setEligibleSearchDraft(v);
                  if (v.trim() === '') handleEligibleSearchChange('');
                }}
                withSubmitButton
                placeholder="Search customer, order ID, invoice ref, or bill-to name"
                controlSize="md"
              />
            </form>
            <div className="relative w-full sm:w-fit sm:justify-self-end">
              {!!filters.location && (
                <FilterDismiss onClear={() => handleLocationChange('')} />
              )}
              <SearchableSelect
                id="eligible-remittance-location"
                value={filters.location}
                onChange={handleLocationChange}
                wrapperClassName="w-full sm:w-52"
                placeholder="All locations"
                searchPlaceholder="Search locations..."
                options={[
                  { value: '', label: 'All locations' },
                  ...locations.map((loc) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                  })),
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-md bg-app-hover px-2.5 py-1.5 sm:px-3">
            <div className="text-xs text-app-fg-muted sm:text-sm">
              <span className="font-medium text-app-fg">{eligibleSelectedIds.size}</span> selected
              {eligibleTotal > 0 ? (
                <>
                  {' '}
                  · <span className="font-medium text-app-fg">{eligibleTotal}</span> total
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-xs font-semibold text-app-fg sm:text-sm">
                <NairaPrice amount={eligibleSelectedTotal} />
              </span>
              {canCreateRemittance && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={openCreateFromEligibleTab}
                  disabled={
                    eligibleSelectedIds.size === 0 ||
                    eligibleMultiLocation ||
                    eligibleTotal === 0 ||
                    !remittanceSelectionComplete
                  }
                  title={
                    eligibleMultiLocation
                      ? 'All selected orders must share the same logistics location'
                      : eligibleSelectedIds.size === 0
                        ? 'Select at least one order'
                        : !remittanceSelectionComplete
                          ? 'Could not resolve every selected order — clear selection and select again'
                          : undefined
                  }
                >
                  Confirm Selection
                </Button>
              )}
            </div>
          </div>

          {eligibleMultiLocation && eligibleSelectedIds.size > 0 && (
            <p className="text-xs text-warning-700 dark:text-warning-300">
              All selected orders must share the same logistics location. Clear the selection or remove orders from
              other locations.
            </p>
          )}

          <CompactTable<EligibleOrder>
            caption="Delivered orders awaiting remittance"
            className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1] [&_thead]:bg-app-hover"
            columns={eligibleColumns}
            rows={eligibleOrders}
            rowKey={(o) => o.id}
            loading={isLoaderRefetchBusy}
            loadingVariant="overlay"
            selection={{
              selectedIds: eligibleSelectedIds,
              onToggle: onEligibleToggle,
              onToggleAll: onEligibleToggleAll,
              getRowId: (o) => o.id,
            }}
            emptyTitle={
              eligibleTotal === 0
                ? 'No delivered orders awaiting remittance'
                : 'No orders match the current filter'
            }
            emptyDescription={
              eligibleTotal === 0
                ? 'When riders or CS mark orders delivered, they appear here until Finance records cash against them.'
                : hasEligibleFilters
                  ? 'Try clearing search or the location filter.'
                  : 'Adjust filters or date range in the header.'
            }
            pagination={{
              page: eligiblePage,
              totalPages: eligibleTotalPages,
              pageParam: 'eligiblePage',
              pageSize: eligiblePageSize,
              pageSizeOptions,
              pageSizeParam: 'eligiblePerPage',
              showWhenSinglePage: true,
              wrapperClassName: 'mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
              controlsClassName: 'sm:justify-end',
              summary: (
                <span className="text-app-fg-muted">
                  {eligibleTotal === 0
                    ? `0 orders · ${eligiblePageSize} per page`
                    : `Showing ${(eligiblePage - 1) * eligiblePageSize + 1}–${Math.min(eligiblePage * eligiblePageSize, eligibleTotal)} of ${eligibleTotal} · ${eligiblePageSize} per page`}
                </span>
              ),
            }}
            renderMobileCard={(o, _i, { rowSelection }) => (
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  {rowSelection}
                  <button
                    type="button"
                    onClick={() => o.invoice && setEligibleInvoicePreview(o.invoice)}
                    disabled={!o.invoice}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <p className="font-mono text-sm font-medium text-brand-600 dark:text-brand-400 truncate">
                      {o.invoice?.referenceFormatted ?? 'No invoice'}
                    </p>
                    <p className="text-xs text-app-fg-muted truncate">
                      {o.invoice?.recipientInfo?.name ?? o.customerName}
                    </p>
                  </button>
                  <div className="shrink-0 text-right">
                    {o.invoice?.totalAmount != null || o.totalAmount != null ? (
                      <NairaPrice
                        amount={Number(o.invoice?.totalAmount ?? o.totalAmount)}
                        className="text-sm font-semibold text-app-fg tabular-nums"
                      />
                    ) : (
                      <span className="text-sm text-app-fg-muted">—</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-mini text-app-fg-muted">
                  <span className="truncate">
                    {o.logisticsLocationName
                      ? o.logisticsLocationProviderName
                        ? `${o.logisticsLocationName} — ${o.logisticsLocationProviderName}`
                        : o.logisticsLocationName
                      : '—'}
                  </span>
                  <span className="shrink-0">{formatDeliveredAt(o.deliveredAt)}</span>
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <TableActionButton
                    variant="neutral"
                    onClick={() => navigateTo(`/admin/orders/${o.id}`)}
                    title="View order"
                  >
                    Order
                  </TableActionButton>
                  {o.invoice ? (
                    <>
                      <TableActionButton
                        variant="primary"
                        title="View invoice"
                        onClick={() => o.invoice && setEligibleInvoicePreview(o.invoice)}
                      >
                        Invoice
                      </TableActionButton>
                      <TableActionButton
                        variant="neutral"
                        title="Download"
                        onClick={() => {
                          if (o.invoice) void generateInvoicePdf(o.invoice);
                        }}
                      >
                        Download
                      </TableActionButton>
                    </>
                  ) : (
                    <generateInvoiceFetcher.Form method="post">
                      <input type="hidden" name="intent" value="generateInvoice" />
                      <input type="hidden" name="orderId" value={o.id} />
                      <TableActionButton
                        variant="primary"
                        type="submit"
                        disabled={isGeneratingInvoice && generatingOrderId === o.id}
                        onClick={() => setGeneratingOrderId(o.id)}
                      >
                        {isGeneratingInvoice && generatingOrderId === o.id ? 'Generating…' : 'Generate Invoice'}
                      </TableActionButton>
                    </generateInvoiceFetcher.Form>
                  )}
                </div>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}
