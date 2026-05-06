import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { useFetcher, useNavigation, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList } from '~/components/ui/description-list';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { StatusBadge } from '~/components/ui/status-badge';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { Tabs } from '~/components/ui/tabs';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';

/** Status options shown as filter pills. Order matches the lifecycle. */
const STATUS_FILTER_OPTIONS: { value: string; label: string; dotColor: string }[] = [
  { value: 'PENDING', label: 'Pending', dotColor: 'bg-warning-500' },
  { value: 'IN_TRANSIT', label: 'In transit', dotColor: 'bg-brand-500' },
  { value: 'RECEIVED', label: 'Received', dotColor: 'bg-success-500' },
  { value: 'DISPUTED', label: 'Disputed', dotColor: 'bg-danger-500' },
  { value: 'CANCELLED', label: 'Cancelled', dotColor: 'bg-app-fg-muted' },
];

function formatRecordedAt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TransfersPage({ transfers, locations, products, levels, canInitiate = true }: TransfersStreamData) {
  const fetcher = useFetcher();
  const cancelFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [viewTransfer, setViewTransfer] = useState<Transfer | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Transfer | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedFromLocation, setSelectedFromLocation] = useState('');
  const [selectedToLocationId, setSelectedToLocationId] = useState('');

  const cancelSubmitting = cancelFetcher.state !== 'idle';
  const [cancelInlineError, setCancelInlineError] = useState<string | null>(null);
  const cancelFetcherError = (cancelFetcher.data as { error?: string } | undefined)?.error ?? null;
  // Local validation errors (e.g. "reason too short") win over stale fetcher
  // errors so the user always sees the most recent feedback.
  const cancelError = cancelInlineError ?? cancelFetcherError;
  useFetcherToast(cancelFetcher.data, { successMessage: 'Transfer cancelled' });

  // Close cancel modal + clear reason on a successful cancel — edge-triggered
  // via the shared hook (see CLAUDE.md → "Modal + Optimistic UI Pattern").
  const handleCancelSuccess = useCallback(() => {
    setCancelTarget(null);
    setCancelReason('');
    setViewTransfer(null);
  }, []);
  useCloseOnFetcherSuccess(cancelFetcher, handleCancelSuccess);

  const submitCancel = () => {
    if (!cancelTarget) return;
    if (cancelReason.trim().length < 10) {
      setCancelInlineError('Cancellation reason must be at least 10 characters.');
      return;
    }
    setCancelInlineError(null);
    const fd = new FormData();
    fd.set('intent', 'cancelTransfer');
    fd.set('transferId', cancelTarget.id);
    fd.set('reason', cancelReason.trim());
    cancelFetcher.submit(fd, { method: 'POST' });
  };

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Transfer recorded' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close-on-success — edge-triggered via the shared hook. Resets the
  // selection state at the same instant the toast appears so a user
  // submitting two transfers in a row doesn't see stale field values.
  const handleCreateTransferSuccess = useCallback(() => {
    setShowForm(false);
    setSelectedProductId('');
    setSelectedFromLocation('');
    setSelectedToLocationId('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleCreateTransferSuccess);

  // Optimistic-add: synthesise a Transfer row from the in-flight payload so
  // the table shows the new entry the instant the user clicks Submit.
  const buildOptimisticTransfers = useCallback(
    (fd: FormData, intent: string): Transfer[] | null => {
      if (intent !== 'initiateTransfer') return null;
      const productId = fd.get('productId')?.toString().trim();
      const fromLocationId = fd.get('fromLocationId')?.toString().trim();
      const toLocationId = fd.get('toLocationId')?.toString().trim();
      const quantitySent = Number(fd.get('quantity')?.toString() ?? '0');
      if (!productId || !fromLocationId || !toLocationId || !Number.isFinite(quantitySent) || quantitySent <= 0) {
        return null;
      }
      return [
        {
          id: optimisticId(),
          productId,
          quantitySent,
          quantityReceived: null,
          fromLocationId,
          toLocationId,
          transferStatus: 'IN_TRANSIT',
          shrinkageReason: null,
          receiverNotes: null,
          transferCost: fd.get('transferCost')?.toString().trim() || null,
          createdAt: new Date().toISOString(),
          verifiedAt: null,
        },
      ];
    },
    [],
  );
  const optimisticTransfers = useOptimisticListMerge<Transfer>(fetcher, buildOptimisticTransfers);
  const displayTransfers = useMemo(
    () => [...optimisticTransfers, ...transfers],
    [optimisticTransfers, transfers],
  );

  useEffect(() => {
    setSelectedToLocationId((prev) => (prev === selectedFromLocation ? '' : prev));
  }, [selectedFromLocation]);

  const getLocationName = (id: string) => {
    const loc = locations.find((l: Location) => l.id === id);
    if (!loc) return id.slice(0, 8) + '...';
    return loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name;
  };

  const activeLocations = locations.filter((l: Location) => l.status === 'ACTIVE');
  const hasDateParams = searchParams.has('startDate') || searchParams.has('endDate') || searchParams.has('period');
  const periodAllTime = searchParams.get('period') === 'all_time' || !hasDateParams;
  const rawStartDate = searchParams.get('startDate') ?? '';
  const rawEndDate = searchParams.get('endDate') ?? '';
  const effectiveDateRange = (() => {
    if (periodAllTime) return { startDate: '', endDate: '' };
    if (rawStartDate && rawEndDate) return { startDate: rawStartDate, endDate: rawEndDate };
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: first.toISOString().slice(0, 10),
      endDate: last.toISOString().slice(0, 10),
    };
  })();

  // Filter state — synced to URL so filters persist across refreshes and can be deep-linked.
  const statusFilter = searchParams.get('status') ?? '';
  const [uiStatusFilter, setUiStatusFilter] = useState(statusFilter);
  const fromLocationFilter = searchParams.get('fromLocationId') ?? '';
  const toLocationFilter = searchParams.get('toLocationId') ?? '';
  const productFilter = searchParams.get('productId') ?? '';
  const isLoaderRefetchBusy = useLoaderRefetchBusy();

  useEffect(() => {
    if (navigation.state === 'idle') {
      setUiStatusFilter(statusFilter);
    }
  }, [statusFilter, navigation.state]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('fromLocationId');
    next.delete('toLocationId');
    next.delete('productId');
    setSearchParams(next, { replace: true });
  };

  const hasFilters = !!(statusFilter || fromLocationFilter || toLocationFilter || productFilter);

  // Stable base set for summary cards + tab counts.
  // Applies date/location/product filters, but intentionally excludes status tab filter.
  // Uses `displayTransfers` so the in-flight optimistic row is included in the
  // counts and tabs the same instant the form submits.
  const summaryTransfers = useMemo(
    () =>
      displayTransfers.filter((t: Transfer) => {
        if (!periodAllTime) {
          const recordedIso = (t.verifiedAt ?? t.createdAt)?.slice(0, 10);
          if (!recordedIso) return false;
          if (recordedIso < effectiveDateRange.startDate || recordedIso > effectiveDateRange.endDate) return false;
        }
        if (fromLocationFilter && t.fromLocationId !== fromLocationFilter) return false;
        if (toLocationFilter && t.toLocationId !== toLocationFilter) return false;
        if (productFilter && t.productId !== productFilter) return false;
        return true;
      }),
    [
      displayTransfers,
      periodAllTime,
      effectiveDateRange.startDate,
      effectiveDateRange.endDate,
      fromLocationFilter,
      toLocationFilter,
      productFilter,
    ],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of summaryTransfers) {
      counts[t.transferStatus] = (counts[t.transferStatus] ?? 0) + 1;
    }
    return counts;
  }, [summaryTransfers]);

  const statusTabItems = useMemo(() => {
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    return [
      { value: '', label: `All (${total})` },
      ...STATUS_FILTER_OPTIONS.map((opt) => ({
        value: opt.value,
        label: `${opt.label} (${statusCounts[opt.value] ?? 0})`,
      })),
    ];
  }, [statusCounts]);

  const filteredTransfers = summaryTransfers.filter((t: Transfer) => {
    if (statusFilter && t.transferStatus !== statusFilter) return false;
    return true;
  });

  const summaryStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      PENDING: 0,
      IN_TRANSIT: 0,
      RECEIVED: 0,
      DISPUTED: 0,
      CANCELLED: 0,
    };
    for (const t of summaryTransfers) {
      counts[t.transferStatus] = (counts[t.transferStatus] ?? 0) + 1;
    }
    return counts;
  }, [summaryTransfers]);

  const summaryQuantitySent = useMemo(
    () => summaryTransfers.reduce((sum, t) => sum + t.quantitySent, 0),
    [summaryTransfers],
  );

  const summaryQuantityReceived = useMemo(
    () => summaryTransfers.reduce((sum, t) => sum + (t.quantityReceived ?? 0), 0),
    [summaryTransfers],
  );

  const handleStatusTabChange = (value: string) => {
    setUiStatusFilter(value);
    updateFilter('status', value);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Transfers"
        description="Send stock between locations. Transfers stay on this list as In transit until the destination confirms receipt (Logistics → Stock Transfer Confirmations)."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Stock transfers tools"
            sheetSubtitle={<span>Date range and new transfer</span>}
            triggerAriaLabel="Stock transfers toolbar and date range"
            desktop={
              <>
                <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={periodAllTime ? '' : effectiveDateRange.startDate}
                    endDate={periodAllTime ? '' : effectiveDateRange.endDate}
                    periodAllTime={periodAllTime}
                  />
                </div>
                {canInitiate && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSelectedProductId('');
                      setSelectedFromLocation('');
                      setSelectedToLocationId('');
                      setShowForm(true);
                    }}
                  >
                    + Record transfer
                  </Button>
                )}
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={periodAllTime ? '' : effectiveDateRange.startDate}
                    endDate={periodAllTime ? '' : effectiveDateRange.endDate}
                    periodAllTime={periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                {canInitiate && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setSelectedProductId('');
                      setSelectedFromLocation('');
                      setSelectedToLocationId('');
                      setShowForm(true);
                    }}
                  >
                    + Record transfer
                  </Button>
                )}
              </>
            )}
          />
        }
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip
        items={[
          { label: 'Transfer records', value: summaryTransfers.length, valueClassName: 'text-app-fg' },
          {
            label: 'Pending',
            value: summaryStatusCounts.PENDING,
            valueClassName: 'text-warning-600 dark:text-warning-400',
          },
          {
            label: 'In transit',
            value: summaryStatusCounts.IN_TRANSIT,
            valueClassName: 'text-brand-600 dark:text-brand-400',
          },
          {
            label: 'Received',
            value: summaryStatusCounts.RECEIVED,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Disputed',
            value: summaryStatusCounts.DISPUTED,
            valueClassName: 'text-danger-600 dark:text-danger-400',
          },
          {
            label: 'Cancelled',
            value: summaryStatusCounts.CANCELLED,
            valueClassName: 'text-app-fg-muted',
          },
          { label: 'Qty sent', value: summaryQuantitySent, valueClassName: 'text-app-fg' },
          {
            label: 'Qty received',
            value: summaryQuantityReceived,
            valueClassName: 'text-brand-600 dark:text-brand-400',
          },
        ]}
      />

      {/* Filters — status pills + from/to/product dropdowns. URL-synced so filters persist
          across refreshes and can be deep-linked. */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={uiStatusFilter}
            onChange={handleStatusTabChange}
            tabs={statusTabItems}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <FormSelect
            id="transfer-filter-from"
            label="From location"
            value={fromLocationFilter}
            onChange={(e) => updateFilter('fromLocationId', e.target.value)}
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((l: Location) => ({
                value: l.id,
                label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
              })),
            ]}
            controlSize="sm"
          />
          <FormSelect
            id="transfer-filter-to"
            label="To location"
            value={toLocationFilter}
            onChange={(e) => updateFilter('toLocationId', e.target.value)}
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((l: Location) => ({
                value: l.id,
                label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
              })),
            ]}
            controlSize="sm"
          />
          <DeferredSection resolve={products} skeleton="inline">
            {(resolvedProducts) => (
              <FormSelect
                id="transfer-filter-product"
                label="Product"
                value={productFilter}
                onChange={(e) => updateFilter('productId', e.target.value)}
                options={[
                  { value: '', label: 'All products' },
                  ...resolvedProducts.map((p: Product) => ({ value: p.id, label: p.name })),
                ]}
                controlSize="sm"
              />
            )}
          </DeferredSection>
        </div>
        {hasFilters && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-app-fg-muted">
              {filteredTransfers.length} of {transfers.length} transfer{transfers.length === 1 ? '' : 's'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {canInitiate && (
        <Modal
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setSelectedProductId('');
            setSelectedFromLocation('');
            setSelectedToLocationId('');
          }}
          maxWidth="max-w-2xl"
          aria-labelledby="transfer-form-title"
        >
          <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
            <DeferredSection resolve={products} skeleton="card">
              {(resolvedProducts) => (
                <DeferredSection resolve={levels} skeleton="card">
                  {(resolvedLevels) => {
                    const activeProducts = resolvedProducts.filter((p: Product) => p.status === 'ACTIVE');

                    const getAvailableStock = (productId: string, locationId: string) => {
                      const level = resolvedLevels.find((l: InventoryLevel) => l.productId === productId && l.locationId === locationId);
                      return level ? level.stockCount - level.reservedCount : 0;
                    };

                    return (
                      <fetcher.Form method="post" className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 id="transfer-form-title" className="text-lg font-semibold text-app-fg">
                            Record stock transfer
                          </h3>
                          <button
                            type="button"
                            onClick={() => {
                              setShowForm(false);
                              setSelectedProductId('');
                              setSelectedFromLocation('');
                              setSelectedToLocationId('');
                            }}
                            className="text-app-fg-muted hover:text-app-fg shrink-0"
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        <input type="hidden" name="intent" value="initiateTransfer" />
                        <input type="hidden" name="productId" value={selectedProductId} />
                        <input type="hidden" name="fromLocationId" value={selectedFromLocation} />
                        <input type="hidden" name="toLocationId" value={selectedToLocationId} />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <SearchableSelect
                            id="transfer-product"
                            label="Product"
                            required
                            value={selectedProductId}
                            onChange={setSelectedProductId}
                            placeholder="Select product..."
                            searchPlaceholder="Search products..."
                            options={activeProducts.map((p: Product) => ({
                              value: p.id,
                              label: p.name,
                            }))}
                          />

                          <SearchableSelect
                            id="transfer-from-location"
                            label="From location"
                            required
                            value={selectedFromLocation}
                            onChange={setSelectedFromLocation}
                            placeholder="Select source..."
                            searchPlaceholder="Search locations..."
                            options={activeLocations.map((l: Location) => ({
                              value: l.id,
                              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                              description: selectedProductId
                                ? `${getAvailableStock(selectedProductId, l.id)} available`
                                : undefined,
                            }))}
                          />

                          <SearchableSelect
                            id="transfer-to-location"
                            label="To location"
                            required
                            value={selectedToLocationId}
                            onChange={setSelectedToLocationId}
                            placeholder="Select destination..."
                            searchPlaceholder="Search locations..."
                            // Mirror the From-location dropdown: when a product
                            // is picked, show the destination's current stock
                            // for that product so the user knows what they're
                            // adding to (e.g. avoid double-stocking a location
                            // that already has plenty).
                            options={activeLocations
                              .filter((l: Location) => l.id !== selectedFromLocation)
                              .map((l: Location) => ({
                                value: l.id,
                                label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                                description: selectedProductId
                                  ? `${getAvailableStock(selectedProductId, l.id)} available`
                                  : undefined,
                              }))}
                          />

                          <TextInput
                            name="quantity"
                            type="number"
                            label={
                              selectedProductId && selectedFromLocation
                                ? `Quantity (max: ${getAvailableStock(selectedProductId, selectedFromLocation)})`
                                : 'Quantity'
                            }
                            min={1}
                            max={selectedProductId && selectedFromLocation ? getAvailableStock(selectedProductId, selectedFromLocation) : undefined}
                            required
                            placeholder="Units to move"
                          />
                        </div>

                        {selectedProductId && selectedFromLocation && (
                          <div className="flex items-center justify-center gap-3 py-2 text-sm text-app-fg-muted">
                            <span className="font-medium text-app-fg-muted">{getLocationName(selectedFromLocation)}</span>
                            <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                            <span className="text-app-fg-muted">Destination</span>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={!selectedProductId || !selectedFromLocation || !selectedToLocationId}
                            loading={fetcher.state === 'submitting'}
                            loadingText="Saving..."
                          >
                            Save transfer
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setShowForm(false);
                              setSelectedProductId('');
                              setSelectedFromLocation('');
                              setSelectedToLocationId('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </fetcher.Form>
                    );
                  }}
                </DeferredSection>
              )}
            </DeferredSection>
          </div>
        </Modal>
      )}

      <div className="card p-4 sm:p-6">
        <DeferredSection resolve={products} skeleton="card">
          {(resolvedProducts) => {
            const productName = (id: string) => resolvedProducts.find((p: Product) => p.id === id)?.name ?? id.slice(0, 8) + '...';

            const columns: CompactTableColumn<Transfer>[] = [
              {
                key: 'product',
                header: 'Product',
                render: (t) => (
                  <span className="font-medium text-app-fg">
                    {productName(t.productId)}
                    {isOptimisticId(t.id) ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-app-fg-muted">Saving…</span>
                    ) : null}
                  </span>
                ),
                minWidth: 'min-w-[140px]',
              },
              {
                key: 'route',
                header: 'From → To',
                render: (t) => (
                  <span className="text-xs text-app-fg-muted sm:text-sm">
                    {getLocationName(t.fromLocationId)} → {getLocationName(t.toLocationId)}
                  </span>
                ),
                minWidth: 'min-w-[160px]',
              },
              {
                key: 'qty',
                header: 'Qty',
                align: 'right',
                render: (t) => <span className="font-medium tabular-nums">{t.quantityReceived ?? t.quantitySent}</span>,
              },
              {
                key: 'recorded',
                header: 'Recorded',
                render: (t) => (
                  <span className="text-app-fg-muted whitespace-nowrap text-xs sm:text-sm">
                    {formatRecordedAt(t.verifiedAt ?? t.createdAt)}
                  </span>
                ),
                hideOnMobile: true,
              },
              {
                key: 'status',
                header: 'Status',
                render: (t) => <StatusBadge status={t.transferStatus} showDot />,
              },
              {
                key: 'actions',
                header: '',
                mobileLabel: 'Actions',
                align: 'right',
                tight: true,
                className: 'w-[1%] whitespace-nowrap',
                render: (t) => (
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <CompactTableActionButton
                      disabled={isOptimisticId(t.id)}
                      onClick={() => setViewTransfer(t)}
                    >
                      View
                    </CompactTableActionButton>
                    {t.transferStatus !== 'CANCELLED' && (
                      <CompactTableActionButton
                        tone="danger"
                        disabled={isOptimisticId(t.id)}
                        onClick={() => {
                          setCancelTarget(t);
                          setCancelReason('');
                        }}
                      >
                        Cancel
                      </CompactTableActionButton>
                    )}
                  </div>
                ),
              },
            ];

            return (
              <CompactTable<Transfer>
                caption="Stock transfers"
                columns={columns}
                rows={filteredTransfers}
                rowKey={(t) => {
                  const o = t as Transfer & {
                    outcomeStatus?: string;
                    outcomeQuantity?: number | null;
                  };
                  if (o.outcomeStatus != null)
                    return `${t.id}-${o.outcomeStatus}-${String(o.outcomeQuantity ?? '')}`;
                  return t.id;
                }}
                rowClassName={(t) => (isOptimisticId(t.id) ? 'opacity-60' : '')}
                loading={isLoaderRefetchBusy}
                loadingVariant="overlay"
                emptyTitle="No transfers yet"
                emptyDescription={
                  periodAllTime
                    ? 'No transfers match your filters, or none recorded yet. In-transit transfers stay visible until received — try the In transit tab or clear filters.'
                    : 'No transfers in this date range. In-transit transfers are dated by when they were sent (created). Try All time or widen the range.'
                }
                withCard={false}
                className="overflow-hidden rounded-xl border border-app-border"
              />
            );
          }}
        </DeferredSection>
      </div>

      <Modal open={!!viewTransfer} onClose={() => setViewTransfer(null)} maxWidth="max-w-lg" aria-labelledby="transfer-detail-title">
        {viewTransfer && (
          <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 id="transfer-detail-title" className="text-lg font-semibold text-app-fg">
                Transfer details
              </h3>
              <button type="button" onClick={() => setViewTransfer(null)} className="text-app-fg-muted hover:text-app-fg shrink-0" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <DeferredSection resolve={products} skeleton="card">
              {(resolvedProducts) => {
                const prod = resolvedProducts.find((p: Product) => p.id === viewTransfer.productId);
                const qtyLabel =
                  viewTransfer.quantityReceived != null && viewTransfer.quantityReceived !== viewTransfer.quantitySent
                    ? `${viewTransfer.quantityReceived} received (${viewTransfer.quantitySent} sent)`
                    : String(viewTransfer.quantityReceived ?? viewTransfer.quantitySent);

                return (
                  <DescriptionList
                    items={[
                      { label: 'Product', value: prod?.name ?? viewTransfer.productId },
                      { label: 'From', value: getLocationName(viewTransfer.fromLocationId) },
                      { label: 'To', value: getLocationName(viewTransfer.toLocationId) },
                      { label: 'Quantity', value: qtyLabel },
                      {
                        label: 'Recorded',
                        value: formatRecordedAt(viewTransfer.verifiedAt ?? viewTransfer.createdAt),
                      },
                      ...(viewTransfer.shrinkageReason
                        ? [{ label: 'Shrinkage reason', value: viewTransfer.shrinkageReason }]
                        : []),
                      ...(viewTransfer.receiverNotes
                        ? [{ label: 'Receiver comment', value: viewTransfer.receiverNotes }]
                        : []),
                    ]}
                  />
                );
              }}
            </DeferredSection>
            <p className="text-xs text-app-fg-muted">
              Confirm or dispute receipt in <span className="font-medium text-app-fg">Logistics → Stock Transfer Confirmations</span>.
            </p>
            <div className="flex items-center justify-end gap-2">
              {viewTransfer.transferStatus !== 'CANCELLED' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCancelTarget(viewTransfer);
                    setCancelReason('');
                  }}
                >
                  Cancel transfer
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={() => setViewTransfer(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel-transfer confirmation. The reason is mandatory (≥ 10 chars) so
          the audit trail explains the reversal. The server reverses both
          inventory legs in one transaction and refuses if the destination has
          already shipped the units. */}
      <ConfirmActionModal
        open={!!cancelTarget}
        onClose={() => {
          if (!cancelSubmitting) {
            setCancelTarget(null);
            setCancelReason('');
            setCancelInlineError(null);
          }
        }}
        title="Cancel this transfer?"
        description={
          cancelTarget
            ? `This will add ${cancelTarget.quantitySent} unit(s) back to ${getLocationName(cancelTarget.fromLocationId)} and remove ${cancelTarget.quantityReceived ?? cancelTarget.quantitySent} unit(s) from ${getLocationName(cancelTarget.toLocationId)}. The transfer row stays for audit but flips to CANCELLED.`
            : ''
        }
        confirmLabel="Cancel transfer"
        cancelLabel="Keep transfer"
        variant="danger"
        loading={cancelSubmitting}
        onConfirm={submitCancel}
        error={cancelError}
        details={
          <div className="space-y-2">
            <label htmlFor="cancel-transfer-reason" className="block text-xs font-semibold text-app-fg-muted uppercase tracking-wider">
              Reason (required, min 10 chars)
            </label>
            <Textarea
              id="cancel-transfer-reason"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                if (cancelInlineError && e.target.value.trim().length >= 10) {
                  setCancelInlineError(null);
                }
              }}
              rows={3}
              placeholder="Why is this transfer being cancelled?"
              maxLength={500}
            />
            <p className="text-[11px] text-app-fg-muted">
              {cancelReason.trim().length}/10 characters minimum
            </p>
          </div>
        }
      />
    </div>
  );
}
