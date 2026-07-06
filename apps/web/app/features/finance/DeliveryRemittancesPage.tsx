import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateInvoicePdf } from '~/lib/invoice-pdf';
import { InvoicePreviewModal } from '~/components/ui/invoice-preview-modal';
import type { OrderInvoice } from '~/features/orders/types';
import { Link, useFetcher, useLocation, useNavigation, useSearchParams } from '@remix-run/react';
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
import { FormSelect } from '~/components/ui/form-select';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { RemittanceInfoIcon, FormulaBreakdownModal } from './remittance-info-modals';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { SearchInput } from '~/components/ui/search-input';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
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
  receivedAt?: string | null;
  duplicateOrderCount?: number;
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
    isDuplicate?: string | null;
    duplicateOfId?: string | null;
  }>;
}

export interface DeliveryRemittanceSummary {
  /** Delivered orders not yet on a cash remittance batch (same scope as Awaiting tab, ignores batch date filter). */
  awaitingAmount: string;
  awaitingCount: string;
  awaitingGrossAmount?: string;
  awaitingDeliveryFees?: string;
  awaitingDeliveryFeeCount?: string;
  totalRemitted: string;
  pendingAmount: string;
  receivedAmount: string;
  disputedAmount: string;
  totalCount: string;
  batchedOrderCount?: string;
  pendingCount: string;
  receivedCount: string;
  disputedCount: string;
  deliveredCount?: string;
  deliveredAmount?: string;
  deliveredNetAmount?: string;
  grossOrderValue?: string;
  totalDeliveryFees?: string;
  deliveryFeeCount?: string;
  totalCommitmentFees?: string;
  commitmentFeeCount?: string;
  totalPosFees?: string;
  posFeeCount?: string;
  totalFailedDeliveryCosts?: string;
  failedDeliveryCount?: string;
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
  viewMode?: 'batches' | 'orders';
  remittanceOrders?: RemittanceOrderRow[];
  remittanceOrdersPagination?: { total: number; totalPages: number };
}

export interface RemittanceOrderRow {
  id: string;
  customerName: string;
  orderNumber: string | null;
  totalAmount: string;
  deliveryFee: string | null;
  deliveredAt: string | null;
  status: string;
  remittanceId: string;
  remittanceStatus: string;
  sentAt: string;
  locationName: string | null;
  providerName: string | null;
  isDuplicate: string | null;
  duplicateOfId: string | null;
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
  viewMode = 'batches',
  remittanceOrders = [],
  remittanceOrdersPagination,
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
  const [infoModal, setInfoModal] = useState<string | null>(null);
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

  const s = summary as Record<string, unknown>;
  const receivedOrderCount = Number(s.receivedOrderCount ?? s.grossOrderCount ?? summary.receivedCount ?? 0);
  const disputedOrderCount = Number(s.disputedOrderCount ?? summary.disputedCount ?? 0);
  const remittedOrderCount = Number(summary.batchedOrderCount ?? 0) || (receivedOrderCount + Number(summary.pendingCount ?? 0) + disputedOrderCount);
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
        render: (r) => (
          <div className="flex items-center justify-end gap-1.5">
            <span className="tabular-nums">{r.orderCount}</span>
            {(r.duplicateOrderCount ?? 0) > 0 && (
              <span className="shrink-0 rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300" title={`${r.duplicateOrderCount} duplicate order${r.duplicateOrderCount === 1 ? '' : 's'} in this batch`}>
                {r.duplicateOrderCount} dup
              </span>
            )}
          </div>
        ),
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
        key: 'receivedAt',
        header: 'Received at',
        nowrap: true,
        render: (r) => r.receivedAt ? (
          <span className="text-sm text-app-fg-muted">
            {new Date(r.receivedAt).toLocaleString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        ) : (
          <span className="text-sm text-app-fg-muted">—</span>
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
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-app-fg truncate max-w-[10rem] inline-block align-bottom">
              {o.invoice?.recipientInfo?.name ?? o.customerName}
            </span>
            {o.isDuplicate && (
              <span className="shrink-0 rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300" title="This order has a similar order for the same customer and product">
                Duplicate
              </span>
            )}
          </div>
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
        tight: true,
        nowrap: true,
        render: (o) => (
          <TableRowActionsSheet
            ariaLabel={`Actions for ${o.customerName}`}
            sheetTitle={o.customerName}
            actions={[
              ...(o.isDuplicate ? [{
                key: 'compare',
                kind: 'link' as const,
                label: 'Compare',
                to: `/admin/finance/delivery-remittances/duplicates/${(o as EligibleOrder & { duplicateOfId?: string | null }).duplicateOfId ?? o.id}`,
              }] : []),
              {
                key: 'order',
                kind: 'link' as const,
                label: 'Order',
                to: `/admin/orders/${o.id}`,
              },
              ...(o.invoice ? [
                {
                  key: 'invoice',
                  kind: 'button' as const,
                  label: 'Invoice',
                  onClick: () => o.invoice && setEligibleInvoicePreview(o.invoice),
                },
                {
                  key: 'download',
                  kind: 'button' as const,
                  label: 'Download invoice',
                  onClick: () => { if (o.invoice) void generateInvoicePdf(o.invoice); },
                },
              ] : []),
            ]}
          />
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
            saveFilterKey
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
          receivedAt: r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '',
        }))}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'location', label: 'Location' },
          { key: 'sentBy', label: 'Sent by' },
          { key: 'orderCount', label: 'Orders' },
          { key: 'batchTotal', label: 'Batch total (₦)' },
          { key: 'status', label: 'Status' },
          { key: 'sentAt', label: 'Sent at' },
          { key: 'receivedAt', label: 'Received at' },
        ]}
        defaultColumns={['id', 'location', 'sentBy', 'orderCount', 'batchTotal', 'status', 'sentAt', 'receivedAt']}
      />

      {(() => {
        const grossVal = Number(summary.grossOrderValue ?? 0);
        const deliveryFees = Number(summary.totalDeliveryFees ?? 0);
        const commitmentFees = Number(summary.totalCommitmentFees ?? 0);
        const posFees = Number(summary.totalPosFees ?? 0);
        const failedDelivery = Number(summary.totalFailedDeliveryCosts ?? 0);
        const netRemittable = grossVal - deliveryFees - commitmentFees - posFees - failedDelivery;
        return (
        <>
        {/* Main stats — Delivered = Awaiting + Remitted + Pending + Disputed */}
        {(() => {
          const pendingGross = Number((summary as unknown as Record<string, unknown>).pendingGrossAmount ?? 0);
          const disputedGross = Number((summary as unknown as Record<string, unknown>).disputedGrossAmount ?? 0);
          // grossOrderValue is now RECEIVED-only, so it IS the remitted gross
          const remittedGross = Number(summary.grossOrderValue ?? 0);
          const remittedCount = Number((summary as unknown as Record<string, unknown>).grossOrderCount ?? summary.receivedCount ?? 0);
          return (
            <OverviewStatStrip
              mobileGrid
              items={[
                {
                  label: <span className="flex items-center">Delivered ({Number(summary.deliveredCount ?? 0)})<RemittanceInfoIcon onClick={() => setInfoModal('delivered')} /></span>,
                  value: <NairaPrice amount={Number(summary.deliveredAmount ?? 0)} />,
                  valueClassName: 'text-app-fg tabular-nums',
                  title: 'Total value = Awaiting + Remitted + Pending + Disputed',
                },
                {
                  label: <span className="flex items-center">Awaiting ({Number(summary.awaitingCount)})<RemittanceInfoIcon onClick={() => setInfoModal('awaiting')} /></span>,
                  value: <NairaPrice amount={summary.awaitingGrossAmount ?? summary.awaitingAmount} />,
                  valueClassName: 'text-info-600 dark:text-info-400 tabular-nums',
                  title: 'Not yet on any remittance batch',
                  onClick: () => { primeSamePathRefetch(); setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('tab'); n.delete('status'); n.set('page', '1'); return n; }, { replace: true }); },
                  active: viewTab === 'eligible' && !pendingStatus,
                },
                {
                  label: <span className="flex items-center">Remitted ({remittedCount})<RemittanceInfoIcon onClick={() => setInfoModal('remitted')} /></span>,
                  value: <NairaPrice amount={remittedGross} />,
                  valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
                  title: 'Cash collected and confirmed by Finance',
                  onClick: () => { primeSamePathRefetch(); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'remittances'); n.set('status', 'RECEIVED'); n.set('page', '1'); return n; }, { replace: true }); },
                  active: viewTab === 'remittances' && pendingStatus === 'RECEIVED',
                },
                {
                  label: <span className="flex items-center">Pending ({Number(summary.pendingCount ?? 0)})<RemittanceInfoIcon onClick={() => setInfoModal('pending')} /></span>,
                  value: <NairaPrice amount={pendingGross} />,
                  valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums',
                  title: 'Sent but not yet confirmed by Finance',
                  onClick: () => { primeSamePathRefetch(); setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'remittances'); n.set('status', 'SENT'); n.set('page', '1'); return n; }, { replace: true }); },
                  active: viewTab === 'remittances' && pendingStatus === 'SENT',
                },
                ...(Number(summary.disputedCount ?? 0) > 0 ? [{
                  label: <span className="flex items-center">Disputed ({Number(summary.disputedCount ?? 0)})<RemittanceInfoIcon onClick={() => setInfoModal('disputed')} /></span>,
                  value: <NairaPrice amount={disputedGross} />,
                  valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' as const,
                  title: 'Needs resolution',
                  onClick: () => { primeSamePathRefetch(); setSearchParams((p: URLSearchParams) => { const n = new URLSearchParams(p); n.set('tab', 'remittances'); n.set('status', 'DISPUTED'); n.set('page', '1'); return n; }, { replace: true }); },
                  active: viewTab === 'remittances' && pendingStatus === 'DISPUTED',
                }] : []),
              ]}
            />
          );
        })()}

        {/* Deductions — received batches only */}
        {grossVal > 0 && (
          <OverviewStatStrip
            mobileGrid
            tileClassName="!py-2"
            items={[
              {
                label: <span className="flex items-center">Gross Order Value ({Number((summary as unknown as Record<string, unknown>).grossOrderCount ?? summary.receivedCount ?? 0)})<RemittanceInfoIcon onClick={() => setInfoModal('gross')} /></span>,
                value: <NairaPrice amount={summary.grossOrderValue ?? '0'} />,
                valueClassName: 'text-app-fg tabular-nums',
              },
              {
                label: `Delivery Fees (${Number(summary.deliveryFeeCount ?? 0)})`,
                value: <NairaPrice amount={summary.totalDeliveryFees ?? '0'} />,
                valueClassName: 'text-red-500 tabular-nums',
              },
              {
                label: `Commitment Fees (${Number(summary.commitmentFeeCount ?? 0)})`,
                value: <NairaPrice amount={summary.totalCommitmentFees ?? '0'} />,
                valueClassName: 'text-red-500 tabular-nums',
              },
              {
                label: `POS Fees (${Number(summary.posFeeCount ?? 0)})`,
                value: <NairaPrice amount={summary.totalPosFees ?? '0'} />,
                valueClassName: 'text-red-500 tabular-nums',
              },
              {
                label: `Failed Delivery (${Number(summary.failedDeliveryCount ?? 0)})`,
                value: <NairaPrice amount={summary.totalFailedDeliveryCosts ?? '0'} />,
                valueClassName: 'text-red-500 tabular-nums',
              },
              {
                label: <span className="flex items-center">Expected Net<RemittanceInfoIcon onClick={() => setInfoModal('net')} /></span>,
                value: <NairaPrice amount={netRemittable} />,
                valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
              },
            ]}
          />
        )}

        {/* Info modals */}
        <FormulaBreakdownModal
          open={infoModal === 'delivered'}
          onClose={() => setInfoModal(null)}
          title="Delivered"
          description="Total gross value of all delivered orders. Equals Awaiting + Remitted + Pending + Disputed."
          lines={[
            { label: 'Awaiting', amount: Number(summary.awaitingGrossAmount ?? summary.awaitingAmount ?? 0), type: 'value', count: Number(summary.awaitingCount ?? 0) },
            { label: 'Remitted (received)', amount: Number(summary.grossOrderValue ?? 0), type: 'value', count: Number((summary as unknown as Record<string, unknown>).grossOrderCount ?? 0) },
            { label: 'Pending (sent)', amount: Number((summary as unknown as Record<string, unknown>).pendingGrossAmount ?? 0), type: 'value', count: Number(summary.pendingCount ?? 0) },
            ...(Number(summary.disputedCount ?? 0) > 0 ? [{ label: 'Disputed', amount: Number((summary as unknown as Record<string, unknown>).disputedGrossAmount ?? 0), type: 'value' as const, count: Number(summary.disputedCount ?? 0) }] : []),
            { label: 'Delivered', amount: Number(summary.deliveredAmount ?? 0), type: 'result', count: Number(summary.deliveredCount ?? 0) },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'remitted'}
          onClose={() => setInfoModal(null)}
          title="Remitted"
          description="Orders on batches confirmed as received by Finance. Gross value before deductions."
          lines={[
            { label: 'Gross order value', amount: Number(summary.grossOrderValue ?? 0), type: 'value', count: Number((summary as unknown as Record<string, unknown>).grossOrderCount ?? 0) },
            { label: 'After deductions (Expected Net)', amount: netRemittable, type: 'result' },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'awaiting'}
          onClose={() => setInfoModal(null)}
          title="Awaiting Remittance"
          description="Gross value of delivered orders not yet placed on any remittance batch. These orders are waiting for an accountant to create a remittance."
          lines={[
            { label: 'Gross order value', amount: Number(summary.awaitingGrossAmount ?? 0), type: 'value', count: Number(summary.awaitingCount ?? 0) },
            { label: 'Delivery fees (deducted on batch)', amount: Number(summary.awaitingDeliveryFees ?? 0), type: 'deduction', count: Number(summary.awaitingDeliveryFeeCount ?? 0) },
            { label: 'Net when batched', amount: Number(summary.awaitingAmount ?? 0), type: 'result', count: Number(summary.awaitingCount ?? 0) },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'pending'}
          onClose={() => setInfoModal(null)}
          title="Pending"
          description="Net value of orders on remittance batches that have been sent but not yet marked as received by Finance. Delivery fees are already deducted."
          lines={[
            { label: 'Orders on SENT batches (net)', amount: Number(summary.pendingAmount ?? 0), type: 'value', count: Number(summary.pendingCount ?? 0) },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'disputed'}
          onClose={() => setInfoModal(null)}
          title="Disputed"
          description="Net value of orders on remittance batches that have been flagged as disputed — the amount was not received as expected."
          lines={[
            { label: 'Orders on DISPUTED batches', amount: Number(summary.disputedAmount ?? 0), type: 'value', count: Number(summary.disputedCount ?? 0) },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'gross'}
          onClose={() => setInfoModal(null)}
          title="Gross Order Value"
          description="Gross value of orders on received remittance batches. Before deductions."
          lines={[
            { label: 'Orders on received batches', amount: grossVal, type: 'value', count: Number(s.grossOrderCount ?? 0) },
            { label: 'Delivery fees', amount: deliveryFees, type: 'deduction', count: Number(summary.deliveryFeeCount ?? 0) },
            { label: 'Expected Net', amount: netRemittable, type: 'result' },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'net'}
          onClose={() => setInfoModal(null)}
          title="Expected Net"
          description="Computed amount the company should receive after all deductions. Compare this to the Actual Received to spot variances."
          lines={[
            { label: 'Gross Order Value', amount: grossVal, type: 'value' },
            { label: 'Delivery Fees', amount: deliveryFees, type: 'deduction', count: Number(summary.deliveryFeeCount ?? 0) },
            { label: 'Commitment Fees', amount: commitmentFees, type: 'deduction', count: Number(summary.commitmentFeeCount ?? 0) },
            { label: 'POS Fees', amount: posFees, type: 'deduction', count: Number(summary.posFeeCount ?? 0) },
            { label: 'Failed Delivery', amount: failedDelivery, type: 'deduction', count: Number(summary.failedDeliveryCount ?? 0) },
            { label: 'Expected Net', amount: netRemittable, type: 'result' },
          ]}
        />
        </>
        );
      })()}

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
          { value: 'remittances', label: viewMode === 'orders' ? `Remitted (${remittedOrderCount} orders)` : `Remitted (${Number(summary.totalCount)} batches)` },
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
                      wrapperClassName="w-full min-w-0 sm:w-48"
                      placeholder="Sent by anyone"
                      searchPlaceholder="Search accountants..."
                      options={[
                        { value: '', label: 'Sent by anyone' },
                        ...sentByOptions.map((u) => ({ value: u.id, label: u.name })),
                      ]}
                    />
                  </div>
                  <FormSelect
                    value={pendingStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={[
                      { value: '', label: viewMode === 'orders' ? `All (${remittedOrderCount} orders)` : `All (${Number(summary.totalCount)} batches)` },

                      { value: 'SENT', label: `Pending (${Number(summary.pendingCount)})` },
                      { value: 'RECEIVED', label: `Received (${receivedOrderCount})` },
                      { value: 'DISPUTED', label: `Disputed (${disputedOrderCount})` },
                    ]}
                    wrapperClassName="w-full sm:w-52"
                  />
                  <FormSelect
                    value={viewMode}
                    onChange={(e) => {
                      const params = new URLSearchParams(location.search);
                      if (e.target.value === 'orders') params.set('view', 'orders');
                      else params.delete('view');
                      params.set('page', '1');
                      setSearchParams(params);
                    }}
                    options={[
                      { value: 'batches', label: 'Batches' },
                      { value: 'orders', label: 'Orders' },
                    ]}
                    wrapperClassName="w-full sm:w-32"
                  />
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
                  <FormSelect
                    value={pendingStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={[
                      { value: '', label: viewMode === 'orders' ? `All (${remittedOrderCount} orders)` : `All (${Number(summary.totalCount)} batches)` },

                      { value: 'SENT', label: `Pending (${Number(summary.pendingCount)})` },
                      { value: 'RECEIVED', label: `Received (${receivedOrderCount})` },
                      { value: 'DISPUTED', label: `Disputed (${disputedOrderCount})` },
                    ]}
                    wrapperClassName="w-full"
                  />
                  <FormSelect
                    value={viewMode}
                    onChange={(e) => {
                      const params = new URLSearchParams(location.search);
                      if (e.target.value === 'orders') params.set('view', 'orders');
                      else params.delete('view');
                      params.set('page', '1');
                      setSearchParams(params);
                    }}
                    options={[
                      { value: 'batches', label: 'Batches' },
                      { value: 'orders', label: 'Orders' },
                    ]}
                    wrapperClassName="w-full"
                  />
                </>
              }
            />
          </div>

          {viewMode === 'orders' ? (
            <CompactTable<RemittanceOrderRow>
              columns={[
                {
                  key: 'orderNumber',
                  header: 'Order',
                  render: (r) => (
                    <span className="text-xs font-mono text-app-fg-muted">
                      {r.orderNumber ?? `${r.id.slice(0, 10)}…`}
                    </span>
                  ),
                },
                {
                  key: 'customerName',
                  header: 'Customer',
                  render: (r) => (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-app-fg truncate max-w-[10rem] inline-block align-bottom">{r.customerName}</span>
                      {r.isDuplicate && (
                        <span className="shrink-0 rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300" title="This order has a similar order for the same customer and product">
                          Duplicate
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'locationName',
                  header: 'Location',
                  render: (r) => (
                    <span className="text-sm text-app-fg-muted truncate max-w-[12rem] block">
                      {r.locationName
                        ? r.providerName
                          ? `${r.locationName} — ${r.providerName}`
                          : r.locationName
                        : '—'}
                    </span>
                  ),
                },
                {
                  key: 'totalAmount',
                  header: 'Net Amount',
                  headerClassName: 'text-right',
                  className: 'text-right',
                  render: (r) => {
                    const net = Number(r.totalAmount || 0) - Number(r.deliveryFee || 0);
                    return <NairaPrice amount={net} className="text-sm font-medium tabular-nums" />;
                  },
                },
                {
                  key: 'deliveredAt',
                  header: 'Delivered',
                  render: (r) => (
                    <span className="text-sm text-app-fg-muted">{formatDeliveredAt(r.deliveredAt)}</span>
                  ),
                },
                {
                  key: 'remittanceStatus',
                  header: 'Status',
                  render: (r) => {
                    const label = r.remittanceStatus === 'SENT' ? 'Pending' : r.remittanceStatus === 'RECEIVED' ? 'Received' : r.remittanceStatus === 'DISPUTED' ? 'Disputed' : r.remittanceStatus;
                    return <StatusBadge status={r.remittanceStatus} label={label} />;
                  },
                },
                {
                  key: 'sentAt',
                  header: 'Sent',
                  render: (r) => (
                    <span className="text-sm text-app-fg-muted">
                      {new Date(r.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  tight: true,
                  render: (r) => (
                    <div className="flex items-center gap-1">
                      {r.isDuplicate && (
                        <CompactTableActionButton to={`/admin/finance/delivery-remittances/duplicates/${r.duplicateOfId ?? r.id}`}>
                          Compare
                        </CompactTableActionButton>
                      )}
                      <CompactTableActionButton to={`/admin/orders/${r.id}`}>
                        Order
                      </CompactTableActionButton>
                      <CompactTableActionButton to={`/admin/finance/delivery-remittances/${r.remittanceId}`}>
                        Batch
                      </CompactTableActionButton>
                    </div>
                  ),
                },
              ]}
              rows={remittanceOrders}
              rowKey={(r) => r.id}
              rowClassName={(r) => r.isDuplicate ? 'bg-warning-50/50 dark:bg-warning-950/20' : ''}
              loading={isLoaderRefetchBusy}
              loadingVariant="overlay"
              emptyTitle="No remitted orders found"
              emptyDescription={hasFilters ? 'Try adjusting your filters' : 'Orders will appear here once remittances are created'}
              pagination={{
                page,
                totalPages: remittanceOrdersPagination?.totalPages ?? 1,
                pageParam: 'page',
                pageSize,
                pageSizeOptions,
                showWhenSinglePage: true,
                wrapperClassName: 'mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
                controlsClassName: 'sm:justify-end',
                summary: (
                  <span className="text-app-fg-muted">
                    {(remittanceOrdersPagination?.total ?? 0) === 0
                      ? '0 orders'
                      : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, remittanceOrdersPagination?.total ?? 0)} of ${remittanceOrdersPagination?.total ?? 0} orders`}
                  </span>
                ),
              }}
              renderMobileCard={(r) => {
                const statusLabel = r.remittanceStatus === 'SENT' ? 'Pending' : r.remittanceStatus === 'RECEIVED' ? 'Received' : r.remittanceStatus === 'DISPUTED' ? 'Disputed' : r.remittanceStatus;
                const net = Number(r.totalAmount || 0) - Number(r.deliveryFee || 0);
                return (
                  <Link
                    to={`/admin/finance/delivery-remittances/${r.remittanceId}`}
                    prefetch="intent"
                    className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
                  >
                    {r.isDuplicate && (
                      <span className="mb-1 inline-block rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">
                        Duplicate order
                      </span>
                    )}
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-fg truncate">{r.customerName}</p>
                        <p className="text-xs text-app-fg-muted truncate">
                          {r.orderNumber ?? `${r.id.slice(0, 10)}…`} ·{' '}
                          {r.locationName
                            ? r.providerName
                              ? `${r.locationName} — ${r.providerName}`
                              : r.locationName
                            : '—'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <NairaPrice amount={net} className="text-sm font-semibold text-app-fg tabular-nums" />
                        <p className="text-mini text-app-fg-muted">
                          {new Date(r.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={r.remittanceStatus} label={statusLabel} />
                  </Link>
                );
              }}
            />
          ) : (
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
                        {r.receivedAt
                          ? new Date(r.receivedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
                          : new Date(r.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
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
          )}
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
            rowClassName={(o) => o.isDuplicate ? 'bg-warning-50/50 dark:bg-warning-950/20' : ''}
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
                    title="Order"
                  >
                    Order
                  </TableActionButton>
                  {o.invoice ? (
                    <>
                      <TableActionButton
                        variant="primary"
                        title="Invoice"
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
