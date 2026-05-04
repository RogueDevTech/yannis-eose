import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { DescriptionList } from '~/components/ui/description-list';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import {
  CompactTable,
  CompactTableActions,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type {
  InventoryLevel, InventoryStreamData, ProductOption, LocationOption, StockMovement,
  Transfer, ReturnedOrder, Reconciliation, LocationWithLock, LowStockAlertsResult,
} from './types';
import {
  MOVEMENT_COLORS,
  formatMovementType,
  REASON_LABELS,
} from './types';

export function InventoryPage({
  levels, totalLevels, levelsPage = 1, levelsTotalPages = 1, levelsLimit = 20,
  levelsProductFilter: serverProductFilter = '', levelsLocationFilter: serverLocationFilter = '',
  levelsSearch: serverSearch = '',
  levelsSort: serverSort = 'default',
  movements, totalMovements, products, locations, canIntake = false, canAdjust = false, canExport = false,
  transfers, returnedOrders, reconciliations, locationsWithLock,
  lowStockThreshold = 10, canEditLowStock = false, lowStockAlerts,
}: InventoryStreamData) {
  const hasTransfers = !!transfers;
  const hasReturns = !!returnedOrders;

  const deliveryDeductions = movements.filter((m) => m.movementType === 'DELIVERY');

  type TabValue = 'levels' | 'delivery_deductions' | 'transfers' | 'returns' | 'reconciliation';
  const [activeTab, setActiveTab] = useState<TabValue>('levels');

  // Stock Levels filter + sort are URL-driven so the backend can do the actual filter/sort/paginate.
  // `levelsProductFilter` empty string = no filter (backend default).
  type LevelsSort = 'default' | 'lowestAvailable' | 'highestAvailable';
  const [searchParams, setSearchParams] = useSearchParams();

  const updateLevelsParam = (key: 'productId' | 'locationId' | 'sort' | 'search', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'ALL' || value === 'default') next.delete(key);
      else next.set(key, value);
      // Any filter/sort/search change resets to page 1.
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const resetLevelsFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('productId');
      next.delete('locationId');
      next.delete('sort');
      next.delete('search');
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  // Controlled search input — submitted on form submit (Enter) or when the user clears it.
  const [searchInput, setSearchInput] = useState(serverSearch);
  useEffect(() => { setSearchInput(serverSearch); }, [serverSearch]);

  const submitSearch = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === serverSearch) return;
    updateLevelsParam('search', trimmed);
  };

  const isLoadingLevels = useLoaderRefetchBusy();

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product';
  const locationName = (id: string | null) => {
    if (!id) return '—';
    const loc = locations.find((l) => l.id === id);
    if (!loc) return 'Unknown location';
    return loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name;
  };

  // displayedLevels is computed below — after the optimisticLevels hook fires
  // (it depends on `fetcher` which isn't declared yet here).
  const currentProductFilter = serverProductFilter || 'ALL';
  const currentLocationFilter = serverLocationFilter || 'ALL';
  const currentSort: LevelsSort = serverSort;
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  /** Bumps when the intake modal opens so quantity/cost fields remount fresh. */
  const [intakeFormInstance, setIntakeFormInstance] = useState(0);
  const [intakeProductId, setIntakeProductId] = useState('');
  const [intakeLocationId, setIntakeLocationId] = useState('');

  type AdjustDirection = 'increase' | 'decrease';
  // Adjust modal: row-level stock correction (signed ADJUSTMENT); direction sets UX + sign.
  const [editingLevel, setEditingLevel] = useState<InventoryLevel | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<AdjustDirection | null>(null);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
  const adjustFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(adjustFetcher.data, { successMessage: 'Stock adjusted' });

  const openAdjustModal = (level: InventoryLevel, direction: AdjustDirection) => {
    setEditingLevel(level);
    setAdjustDirection(direction);
    setAdjustQty('');
    setAdjustReason('');
  };

  const closeAdjustModal = () => {
    setEditingLevel(null);
    setAdjustDirection(null);
    setAdjustQty('');
    setAdjustReason('');
  };

  const openIntakeModal = (prefill: { productId: string; locationId: string } | null) => {
    if (prefill) {
      setIntakeProductId(prefill.productId);
      setIntakeLocationId(prefill.locationId);
    } else {
      setIntakeProductId('');
      setIntakeLocationId('');
    }
    setIntakeFormInstance((n) => n + 1);
    setShowIntakeForm(true);
  };

  const openIntakeFromAdjustIncrease = () => {
    if (!canIntake || !editingLevel) return;
    const prefill = { productId: editingLevel.productId, locationId: editingLevel.locationId };
    closeAdjustModal();
    openIntakeModal(prefill);
  };

  const signedAdjustmentQuantityStr = useMemo(() => {
    const n = parseInt(adjustQty.trim(), 10);
    if (!Number.isFinite(n) || n < 1) return '';
    if (adjustDirection === 'decrease') return String(-n);
    if (adjustDirection === 'increase') return String(n);
    return '';
  }, [adjustQty, adjustDirection]);

  useEffect(() => {
    if (adjustFetcher.state === 'idle' && adjustFetcher.data?.success) {
      setEditingLevel(null);
      setAdjustDirection(null);
      setAdjustReason('');
      setAdjustQty('');
    }
  }, [adjustFetcher.state, adjustFetcher.data]);

  const fetcher = useFetcher();

  const intakeError = (fetcher.data as { error?: string } | undefined)?.error;
  const intakeErrorRef = useRef<HTMLDivElement>(null);
  const [dismissedIntakeError, setDismissedIntakeError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Stock added successfully' });

  useEffect(() => {
    if (intakeError) setDismissedIntakeError(false);
  }, [intakeError]);

  useEffect(() => {
    if (intakeError && intakeErrorRef.current) {
      intakeErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [intakeError]);

  /**
   * Edge-trigger close + reset on successful intake. Replaces the old
   * `useEffect([fetcher.data, showIntakeForm])` variant per CLAUDE.md →
   * "Modal + Optimistic UI Pattern". Intent-filtered so the same `fetcher`
   * (which also handles `adjustStock`, `markIntakeReceipt`, etc.) doesn't
   * tear down the intake modal on unrelated success.
   */
  const handleIntakeSuccess = useCallback(() => {
    setShowIntakeForm(false);
    setIntakeProductId('');
    setIntakeLocationId('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleIntakeSuccess, { intent: 'stockIntake' });

  /**
   * Optimistic-add: derive a synthetic InventoryLevel row from the in-flight
   * `stockIntake` payload so the new row appears in the table the same React
   * tick the toast fires. Sticks through revalidation; canonical row replaces
   * it cleanly when the loader returns. The render path below dims the row
   * with `opacity-60`, shows a "Saving…" chip, and disables row actions while
   * the synthetic id is in flight (`__optimistic_…` would 404 the API).
   *
   * We only synthesize when the (productId, locationId) pair isn't already in
   * the levels list — when it IS already there, the server does an UPDATE
   * (stockCount += quantity) and the existing row is sufficient. This avoids
   * showing a duplicate row while the actual UPDATE is in flight.
   */
  const buildOptimisticLevels = useCallback<
    (fd: FormData, intent: string) => InventoryLevel[] | null
  >(
    (fd, intent) => {
      if (intent !== 'stockIntake') return null;
      const productId = fd.get('productId')?.toString().trim();
      const locationId = fd.get('locationId')?.toString().trim();
      const qty = parseInt(fd.get('quantity')?.toString() ?? '0', 10);
      if (!productId || !locationId || !Number.isFinite(qty) || qty < 1) return null;
      // If a row for this (product, location) already exists, server UPDATEs it
      // — don't synthesize a duplicate. Optimistic visual feedback for the
      // increment isn't worth the duplicate-row confusion.
      const existing = levels.some((l) => l.productId === productId && l.locationId === locationId);
      if (existing) return null;
      return [
        {
          id: optimisticId(`${productId}_${locationId}`),
          productId,
          locationId,
          stockCount: qty,
          reservedCount: 0,
          status: 'AVAILABLE',
          updatedAt: new Date().toISOString(),
        },
      ];
    },
    [levels],
  );
  // `awaitSuccess: true` — only render the synthetic row AFTER the action
  // returns success (during the loader-revalidation window). The intake
  // modal blocks the table during submit so an optimistic-during-submit row
  // would be invisible; this also avoids a brief "row appears, then
  // disappears" flash if the intake fails server-side.
  const optimisticLevels = useOptimisticListMerge<InventoryLevel>(
    fetcher,
    buildOptimisticLevels,
    { awaitSuccess: true },
  );

  /** Prepend in-flight optimistic rows so the user sees their addition the
   * same React tick the toast appears. Server's default sort is
   * `updatedAt DESC` so prepending matches the canonical order — the
   * synthetic row stays at top until it's replaced by the canonical row. */
  const displayedLevels = useMemo(
    () => [...optimisticLevels, ...levels],
    [levels, optimisticLevels],
  );

  // Low-stock threshold editor (admin-only)
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [draftThreshold, setDraftThreshold] = useState<number>(lowStockThreshold);
  useEffect(() => { setDraftThreshold(lowStockThreshold); }, [lowStockThreshold]);
  const thresholdFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(thresholdFetcher.data, { successMessage: 'Low-stock threshold updated' });
  useEffect(() => {
    if (thresholdFetcher.data?.success) {
      setShowThresholdModal(false);
    }
  }, [thresholdFetcher.data]);

  const totalStock = levels.reduce((sum, l) => sum + l.stockCount, 0);
  const totalReserved = levels.reduce((sum, l) => sum + l.reservedCount, 0);

  /** CompactTable columns for stock levels — `hideOnMobile` drops Reserved + Status
   *  on narrow desktop table columns; mobile uses card rows from the same component. */
  const levelColumns: CompactTableColumn<InventoryLevel>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (level) => {
        const isOptimistic = isOptimisticId(level.id);
        return (
          <span className="font-medium text-app-fg">
            {productName(level.productId)}
            {isOptimistic && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-app-fg-muted italic">Saving…</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'location',
      header: 'Location',
      render: (level) => <span className="text-app-fg-muted">{locationName(level.locationId)}</span>,
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      render: (level) => <span className="font-medium tabular-nums">{level.stockCount}</span>,
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right',
      hideOnMobile: true,
      render: (level) => (
        <span className="text-warning-600 dark:text-warning-400 tabular-nums">{level.reservedCount}</span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: (level) => (
        <span className="font-medium text-success-600 dark:text-success-400 tabular-nums">
          {level.stockCount - level.reservedCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (level) => <StatusBadge status={level.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: (level) => {
        const isOptimistic = isOptimisticId(level.id);
        // Variant rule (CLAUDE.md → "Table Action Buttons"): one action →
        // primary; two-or-more → primary (View) + neutral (secondary) + danger
        // (destructive). When optimistic, View becomes inert.
        return (
          <div className="inline-flex items-center justify-end gap-1.5">
            {isOptimistic ? (
              <TableActionButton inert variant="primary">View</TableActionButton>
            ) : (
              <TableActionButton to={`/admin/inventory/${level.id}`} prefetch="intent" variant="primary">
                View
              </TableActionButton>
            )}
            {canAdjust && (
              <>
                <TableActionButton
                  variant="danger"
                  disabled={isOptimistic}
                  onClick={() => openAdjustModal(level, 'decrease')}
                >
                  Remove
                </TableActionButton>
                <TableActionButton
                  variant="neutral"
                  disabled={isOptimistic}
                  onClick={() => openAdjustModal(level, 'increase')}
                >
                  Add
                </TableActionButton>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        title="Inventory"
        description="Track stock levels, transfers, and reconciliations across all locations"
        actions={
          <PageHeaderMobileTools
            sheetTitle="Inventory tools"
            sheetSubtitle={<span>Threshold, stock intake, and export</span>}
            triggerAriaLabel="Inventory toolbar"
            desktop={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <PageRefreshButton />
                <button
                  type="button"
                  onClick={() => canEditLowStock && setShowThresholdModal(true)}
                  disabled={!canEditLowStock}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-app-border bg-app-elevated transition-colors whitespace-nowrap ${
                    canEditLowStock
                      ? 'text-app-fg-muted hover:text-app-fg hover:border-app-border-strong cursor-pointer'
                      : 'text-app-fg-muted cursor-default'
                  }`}
                  title={canEditLowStock ? 'Click to change low-stock alert threshold' : 'Low-stock alert threshold (read-only)'}
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                  <span>
                    <span className="sm:hidden">&lt; <strong className="text-app-fg">{lowStockThreshold}</strong></span>
                    <span className="hidden sm:inline">Alert &lt; <strong className="text-app-fg">{lowStockThreshold}</strong> units</span>
                  </span>
                </button>
                {canIntake && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1 sm:flex-initial whitespace-nowrap"
                    onClick={() => {
                      if (showIntakeForm) {
                        setShowIntakeForm(false);
                        setIntakeProductId('');
                        setIntakeLocationId('');
                      } else {
                        openIntakeModal(null);
                      }
                    }}
                  >
                    {showIntakeForm ? (
                      'Close'
                    ) : (
                      <>
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span className="sm:hidden">Intake</span>
                        <span className="hidden sm:inline">Stock Intake</span>
                      </>
                    )}
                  </Button>
                )}
                {canExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 sm:flex-initial whitespace-nowrap"
                    onClick={() => setShowExportModal(true)}
                  >
                    <span className="sm:hidden">Report</span>
                    <span className="hidden sm:inline">Generate report</span>
                  </Button>
                )}
              </div>
            }
            sheet={({ closeSheet }) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (canEditLowStock) {
                      closeSheet();
                      setShowThresholdModal(true);
                    }
                  }}
                  disabled={!canEditLowStock}
                  className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-app-border bg-app-elevated px-3 py-2 text-sm ${
                    canEditLowStock
                      ? 'text-app-fg-muted hover:text-app-fg hover:border-app-border-strong'
                      : 'cursor-default text-app-fg-muted opacity-60'
                  }`}
                >
                  Alert &lt; <strong className="text-app-fg">{lowStockThreshold}</strong> units
                </button>
                {canIntake && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      if (showIntakeForm) {
                        setShowIntakeForm(false);
                        setIntakeProductId('');
                        setIntakeLocationId('');
                      } else {
                        openIntakeModal(null);
                      }
                    }}
                  >
                    {showIntakeForm ? 'Close stock intake' : 'Stock Intake'}
                  </Button>
                )}
                {canExport && (
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
                )}
              </>
            )}
          />
        }
      />
      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.inventory}
        initialFilters={{
          productId: serverProductFilter || undefined,
          locationId: serverLocationFilter || undefined,
          search: serverSearch || undefined,
          sort: serverSort === 'default' ? undefined : serverSort,
        }}
      />

      {/* Stock Intake modal (only when user has inventory.intake) */}
      {canIntake && showIntakeForm && (
        <Modal
          open
          onClose={() => {
            setShowIntakeForm(false);
            setIntakeProductId('');
            setIntakeLocationId('');
          }}
          maxWidth="max-w-2xl"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-app-fg">Receive Stock (Stock Intake)</h3>
              <p className="text-sm text-app-fg-muted mt-1">
                Add a new FIFO batch. Each intake creates a batch with its own factory and landing cost.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowIntakeForm(false);
                setIntakeProductId('');
                setIntakeLocationId('');
              }}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {intakeError && !dismissedIntakeError && (
            <div ref={intakeErrorRef}>
              <PageNotification
                variant="error"
                message={intakeError}
                durationMs={5000}
                onDismiss={() => setDismissedIntakeError(true)}
              />
            </div>
          )}
          {(products.length === 0 || locations.length === 0) ? (
            <InlineNotification
              variant="warning"
              message={
                products.length === 0 && locations.length === 0
                  ? 'You need at least one product and one logistics location before you can receive stock.'
                  : products.length === 0
                    ? 'You need at least one product before you can receive stock.'
                    : 'You need at least one logistics location before you can receive stock.'
              }
              actions={
                products.length === 0 && locations.length === 0
                  ? [
                      { label: 'New product', href: '/admin/products/new' },
                      { label: 'Logistics partners', href: '/admin/logistics/partners' },
                    ]
                  : products.length === 0
                    ? [{ label: 'New product', href: '/admin/products/new' }]
                    : [{ label: 'Logistics partners', href: '/admin/logistics/partners' }]
              }
            />
          ) : (
            <fetcher.Form
              key={intakeFormInstance}
              method="post"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <input type="hidden" name="intent" value="stockIntake" />
              <input type="hidden" name="productId" value={intakeProductId} />
              <input type="hidden" name="locationId" value={intakeLocationId} />
              <SearchableSelect
                label="Product"
                id="intake-productId"
                required
                value={intakeProductId}
                onChange={setIntakeProductId}
                placeholder="Select product..."
                searchPlaceholder="Search products..."
                options={products.map((p: ProductOption) => ({ value: p.id, label: p.name }))}
                wrapperClassName="sm:col-span-2"
              />
              <SearchableSelect
                label="Location"
                id="intake-locationId"
                required
                value={intakeLocationId}
                onChange={setIntakeLocationId}
                placeholder="Select location..."
                searchPlaceholder="Search locations..."
                options={locations.map((l: LocationOption) => ({
                  value: l.id,
                  label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                }))}
                wrapperClassName="sm:col-span-2"
              />
              <TextInput
                label="Quantity"
                id="intake-quantity"
                name="quantity"
                type="number"
                required
                min={1}
                placeholder="0"
              />
              <div>
                <label htmlFor="intake-factoryCost" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Factory Cost (&#8358;)
                </label>
                <AmountInput
                  id="intake-factoryCost"
                  name="factoryCost"
                  required
                  className="input"
                  placeholder="0.00"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="intake-landingCost" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Landing Cost (&#8358;)
                </label>
                <AmountInput
                  id="intake-landingCost"
                  name="landingCost"
                  className="input"
                  placeholder="0.00"
                  defaultValue="0"
                />
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Freight, duty, etc. Default 0.
                </p>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-app-border">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowIntakeForm(false);
                    setIntakeProductId('');
                    setIntakeLocationId('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!intakeProductId || !intakeLocationId}
                  loading={fetcher.state === 'submitting'}
                  loadingText="Adding..."
                >
                  Add Stock
                </Button>
              </div>
            </fetcher.Form>
          )}
        </Modal>
      )}

      {/* Adjust modal — signed ADJUSTMENT movement + reason (intake handles receipts with COGS). */}
      {canAdjust && editingLevel && adjustDirection && (
        <Modal
          open
          onClose={closeAdjustModal}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-app-fg">
                {adjustDirection === 'decrease' ? 'Remove stock' : 'Add units (adjustment)'}
              </h3>
              <p className="text-sm text-app-fg-muted mt-1 truncate">
                {productName(editingLevel.productId)} · {locationName(editingLevel.locationId)}
              </p>
              <p className="text-xs text-app-fg-muted mt-1">
                On hand: <span className="font-medium text-app-fg">{editingLevel.stockCount}</span> · Reserved:{' '}
                {editingLevel.reservedCount} · Available:{' '}
                <span className="font-medium text-app-fg">{editingLevel.stockCount - editingLevel.reservedCount}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={closeAdjustModal}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {adjustDirection === 'increase' && (
            <InlineNotification
              variant="info"
              message={
                canIntake
                  ? 'Received goods with invoices or cost basis? Use Stock Intake so landed cost is tracked in FIFO batches.'
                  : 'Received goods with invoices or cost basis? Ask someone with Stock Intake access to record the receipt so landed cost is tracked in FIFO batches.'
              }
              actions={
                canIntake ? [{ label: 'Open stock intake', onClick: openIntakeFromAdjustIncrease }] : undefined
              }
            />
          )}
          {adjustFetcher.data?.error && (
            <PageNotification
              variant="error"
              message={adjustFetcher.data.error}
              onDismiss={() => { /* transient — dismisses with modal close */ }}
            />
          )}
          <adjustFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="adjustStock" />
            <input type="hidden" name="productId" value={editingLevel.productId} />
            <input type="hidden" name="locationId" value={editingLevel.locationId} />
            <input type="hidden" name="adjustmentQuantity" value={signedAdjustmentQuantityStr} />
            <TextInput
              label={adjustDirection === 'decrease' ? 'Units to remove' : 'Units to add'}
              id="adjust-qty-display"
              type="number"
              required
              min={1}
              max={adjustDirection === 'decrease' ? editingLevel.stockCount : undefined}
              placeholder="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              hint={
                adjustDirection === 'decrease'
                  ? `Removes from on-hand stock (max ${editingLevel.stockCount}). Creates an ADJUSTMENT movement — not a FIFO batch.`
                  : 'For true count gains only. New supply with cost should use Stock Intake.'
              }
            />
            <Textarea
              label="Reason"
              id="adjust-reason"
              name="reason"
              rows={3}
              required
              placeholder="Why is this adjustment needed? (min 10 characters)"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" onClick={closeAdjustModal}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !signedAdjustmentQuantityStr ||
                  adjustReason.trim().length < 10 ||
                  adjustFetcher.state !== 'idle'
                }
                loading={adjustFetcher.state !== 'idle'}
                loadingText={adjustDirection === 'decrease' ? 'Removing…' : 'Adding…'}
              >
                {adjustDirection === 'decrease' ? 'Remove' : 'Add units'}
              </Button>
            </div>
          </adjustFetcher.Form>
        </Modal>
      )}

      {/* Low-stock threshold modal — admin-only */}
      {canEditLowStock && showThresholdModal && (
        <Modal
          open
          onClose={() => setShowThresholdModal(false)}
          maxWidth="max-w-sm"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div>
            <h3 className="text-lg font-semibold text-app-fg">Low-stock alert threshold</h3>
            <p className="text-sm text-app-fg-muted mt-1">
              When a product's available stock at any location drops below this number, SuperAdmins, Admins, and Stock Managers get an in-app + push notification. Rate-limited to one alert per location per 6 hours.
            </p>
          </div>
          {thresholdFetcher.data?.error && (
            <PageNotification
              variant="error"
              message={thresholdFetcher.data.error}
              onDismiss={() => { /* transient — clears with modal close */ }}
            />
          )}
          <thresholdFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="updateLowStockThreshold" />
            <div className="flex items-center gap-3">
              <TextInput
                id="low-stock-threshold-input"
                name="lowStockThreshold"
                type="number"
                min={1}
                max={10000}
                value={draftThreshold}
                onChange={(e) => setDraftThreshold(Math.max(1, Math.min(10000, parseInt(e.target.value, 10) || 1)))}
                wrapperClassName="w-32"
              />
              <span className="text-xs text-app-fg-muted">units</span>
            </div>
            <p className="text-xs text-app-fg-muted">
              Saved: <strong>{lowStockThreshold} units</strong>
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowThresholdModal(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={draftThreshold === lowStockThreshold || thresholdFetcher.state === 'submitting'}
                loading={thresholdFetcher.state === 'submitting'}
                loadingText="Saving..."
              >
                Save threshold
              </Button>
            </div>
          </thresholdFetcher.Form>
        </Modal>
      )}

      <DeferredSection resolve={totalMovements} fallback={<OverviewStatStripSkeleton count={4} />}>
        {(count) => (
          <OverviewStatStrip
            items={[
              { label: 'Total Stock', value: totalStock.toLocaleString(), valueClassName: 'text-app-fg' },
              { label: 'Reserved', value: totalReserved.toLocaleString(), valueClassName: 'text-warning-600 dark:text-warning-400' },
              {
                label: 'Available',
                value: (totalStock - totalReserved).toLocaleString(),
                valueClassName: 'text-success-600 dark:text-success-400',
              },
              { label: 'Movements', value: count, valueClassName: 'text-app-fg' },
            ]}
          />
        )}
      </DeferredSection>

      {/* Low-stock alert — compact summary + small cards in a responsive grid (not bound to current page). */}
      {lowStockAlerts && (
        <DeferredSection resolve={lowStockAlerts} skeleton="card">
          {(alerts) => {
            const a = alerts as LowStockAlertsResult;
            if (a.items.length === 0) return null;
            const preview = a.items.slice(0, 8);
            const extra = a.items.length - preview.length;
            return (
              <div className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 px-3 py-3 sm:px-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-warning-600 dark:text-warning-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm font-medium text-warning-800 dark:text-warning-200 min-w-0">
                    {a.items.length} {a.items.length === 1 ? 'product is' : 'products are'} below the{' '}
                    <span className="tabular-nums">{a.threshold}</span>-unit alert threshold
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                  {preview.map((item) => (
                    <div
                      key={item.levelId}
                      className="rounded-md border border-warning-200/90 dark:border-warning-800/80 bg-app-elevated/90 dark:bg-warning-950/25 px-2.5 py-2 min-w-0 shadow-sm"
                    >
                      <Link
                        to={`/admin/inventory/${item.levelId}`}
                        prefetch="intent"
                        className="block hover:opacity-90 transition-opacity"
                        title={`${item.productName} — ${item.locationName}`}
                      >
                        <p className="text-xs font-semibold text-app-fg leading-snug line-clamp-2">{item.productName}</p>
                        <p className="text-[11px] text-app-fg-muted mt-0.5 line-clamp-1">{item.locationName}</p>
                        <p
                          className={`text-xs font-bold tabular-nums mt-1.5 ${
                            item.availableCount <= 0
                              ? 'text-danger-600 dark:text-danger-400'
                              : 'text-warning-800 dark:text-warning-200'
                          }`}
                        >
                          {item.availableCount} avail
                        </p>
                      </Link>
                      {canIntake && (
                        <div className="mt-2 pt-2 border-t border-warning-200/70 dark:border-warning-800/60">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => openIntakeModal({ productId: item.productId, locationId: item.locationId })}
                          >
                            Restock
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => updateLevelsParam('sort', 'lowestAvailable')}
                    className="mt-2.5 w-full sm:w-auto text-left text-xs font-medium text-warning-800 dark:text-warning-200 underline underline-offset-2 hover:text-warning-900 dark:hover:text-warning-100"
                  >
                    + {extra} more — sort table by lowest available →
                  </button>
                )}
              </div>
            );
          }}
        </DeferredSection>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabValue)}
        tabs={[
          { value: 'levels', label: `Stock Levels (${totalLevels})` },
          { value: 'delivery_deductions', label: `Delivery Deductions (${deliveryDeductions.length})` },
          ...(hasTransfers ? [{ value: 'transfers' as const, label: `Transfers (${transfers.length})` }] : []),
          ...(hasReturns ? [{ value: 'returns' as const, label: `Returns (${returnedOrders.length})` }] : []),
          ...(reconciliations != null ? [{ value: 'reconciliation' as const, label: 'Reconciliation' }] : []),
        ]}
      />

      {/* Content */}
      {activeTab === 'levels' && (
        <>
        {/* Filter + search + sort row. Hidden only when there is no data AND no active filter. */}
        {(totalLevels > 0 || currentProductFilter !== 'ALL' || currentLocationFilter !== 'ALL' || currentSort !== 'default' || serverSearch) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchableSelect
              id="levels-product-filter"
              value={currentProductFilter}
              onChange={(v) => updateLevelsParam('productId', v)}
              wrapperClassName="w-full sm:w-48"
              placeholder="All products"
              searchPlaceholder="Search products..."
              options={[
                { value: 'ALL', label: 'All products' },
                ...products.map((p: ProductOption) => ({ value: p.id, label: p.name })),
              ]}
            />
            <SearchableSelect
              id="levels-location-filter"
              value={currentLocationFilter}
              onChange={(v) => updateLevelsParam('locationId', v)}
              wrapperClassName="w-full sm:w-48"
              placeholder="All locations"
              searchPlaceholder="Search locations..."
              options={[
                { value: 'ALL', label: 'All locations' },
                ...locations.map((l: LocationOption) => ({
                  value: l.id,
                  label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                })),
              ]}
            />
            <form
              method="get"
              className="flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(searchInput);
              }}
            >
              <SearchInput
                name="search"
                placeholder="Search by product name…"
                value={searchInput}
                onChange={(val) => {
                  setSearchInput(val);
                  // Clearing the field commits the reset immediately so the list doesn't look stuck.
                  if (val === '') submitSearch('');
                }}
                wrapperClassName="w-full"
              />
            </form>
            <FormSelect
              label=""
              id="levels-sort"
              name="levelsSort"
              value={currentSort}
              onChange={(e) => updateLevelsParam('sort', e.target.value)}
              wrapperClassName="w-full sm:w-48"
              options={[
                { value: 'default', label: 'Default order' },
                { value: 'lowestAvailable', label: 'Lowest available first' },
                { value: 'highestAvailable', label: 'Highest available first' },
              ]}
              aria-label="Sort order"
            />
            {(currentProductFilter !== 'ALL' || currentLocationFilter !== 'ALL' || currentSort !== 'default' || serverSearch) && (
              <button
                type="button"
                onClick={resetLevelsFilters}
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline self-center shrink-0"
              >
                Reset
              </button>
            )}
          </div>
        )}
        <CompactTable<InventoryLevel>
          columns={levelColumns}
          rows={displayedLevels}
          rowKey={(r) => r.id}
          rowClassName={(level) => (isOptimisticId(level.id) ? 'opacity-60' : '')}
          loading={isLoadingLevels}
          loadingVariant="overlay"
          emptyTitle={
            levels.length === 0
              ? 'No inventory data yet'
              : 'No inventory matches your filter'
          }
          emptyDescription={
            levels.length === 0
              ? 'Add products and receive stock to get started.'
              : 'Try changing the product filter or sort.'
          }
        />

        {/* Pagination — server-side, drives `page` URL param. */}
        {levelsTotalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-app-fg-muted">
              {totalLevels > 0
                ? `Showing ${(levelsPage - 1) * levelsLimit + 1}–${Math.min(levelsPage * levelsLimit, totalLevels)} of ${totalLevels} rows`
                : 'No rows'}
            </p>
            <Pagination page={levelsPage} totalPages={levelsTotalPages} pageParam="page" />
          </div>
        )}
        </>
      )}

      {activeTab === 'transfers' && hasTransfers && (
        <TransfersTab
          transfers={transfers}
          products={products}
          locations={locations}
          routeLoaderBusy={isLoadingLevels}
        />
      )}

      {activeTab === 'delivery_deductions' && (
        <DeliveryDeductionsTab
          movements={deliveryDeductions}
          productName={productName}
          locationName={locationName}
        />
      )}

      {activeTab === 'returns' && hasReturns && (
        <ReturnsTab
          returnedOrders={returnedOrders}
          locationsWithLock={locationsWithLock ?? []}
          fetcher={fetcher}
        />
      )}

      {activeTab === 'reconciliation' && reconciliations != null && (
        <ReconciliationTab
          reconciliations={reconciliations}
          products={products}
          locations={locations}
          locationsWithLock={locationsWithLock ?? []}
          fetcher={fetcher}
        />
      )}
    </div>
  );
}

/* ── Transfers Tab ── */

function DeliveryDeductionsTab({
  movements,
  productName,
  locationName,
}: {
  movements: StockMovement[];
  productName: (id: string) => string;
  locationName: (id: string | null) => string;
}) {
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const selectedOrderId =
    selectedMovement && typeof selectedMovement.referenceId === 'string' && selectedMovement.referenceId.length > 0
      ? selectedMovement.referenceId
      : null;

  const deductionColumns = useMemo((): CompactTableColumn<StockMovement>[] => [
    {
      key: 'type',
      header: 'Type',
      render: (m) => (
        <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
          {formatMovementType(m.movementType)}
        </span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      render: (m) => <span className="font-medium text-app-fg">{productName(m.productId)}</span>,
      minWidth: 'min-w-[140px]',
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (m) => <span className="text-app-fg">{m.referenceCustomerName ?? '—'}</span>,
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      nowrap: true,
      render: (m) => (
        <span className="font-medium text-danger-600 dark:text-danger-400 tabular-nums">
          -{Math.abs(m.quantity)}
        </span>
      ),
    },
    {
      key: 'from',
      header: 'From',
      hideOnMobile: true,
      render: (m) => <span className="text-app-fg-muted">{locationName(m.fromLocationId)}</span>,
    },
    {
      key: 'to',
      header: 'To',
      hideOnMobile: true,
      render: (m) => <span className="text-app-fg-muted">{locationName(m.toLocationId)}</span>,
    },
    {
      key: 'route',
      header: 'Route',
      className: 'sm:hidden',
      render: (m) => (
        <span className="text-xs text-app-fg-muted">
          {locationName(m.fromLocationId)} → {locationName(m.toLocationId)}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      render: (m) => (
        <span className="text-app-fg-muted whitespace-nowrap text-xs sm:text-sm">
          {new Date(m.createdAt).toLocaleDateString('en-NG', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      minWidth: 'min-w-[4.5rem]',
      mobileShowLabel: false,
      render: (m) => (
        <CompactTableActions className="justify-end shrink-0">
          <CompactTableActionButton onClick={() => setSelectedMovement(m)}>View</CompactTableActionButton>
        </CompactTableActions>
      ),
    },
  ], [productName, locationName]);

  return (
    <>
      <div className="card p-0">
        <CompactTable<StockMovement>
          caption="Delivery deductions"
          columns={deductionColumns}
          rows={movements}
          rowKey={(m) => m.id}
          withCard={false}
          className="min-w-[720px]"
          emptyTitle="No delivery deductions yet"
          emptyDescription="Stock reductions from delivered orders will appear here."
          renderMobileCard={(m) => (
            <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                  {formatMovementType(m.movementType)}
                </span>
                <span className="font-medium text-danger-600 dark:text-danger-400 tabular-nums">
                  -{Math.abs(m.quantity)}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-medium text-app-fg">{productName(m.productId)}</p>
                <p className="text-app-fg-muted">{m.referenceCustomerName ?? '—'}</p>
                <p className="text-app-fg-muted">{locationName(m.fromLocationId)} → {locationName(m.toLocationId)}</p>
                <p className="text-xs text-app-fg-muted">
                  {new Date(m.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="pt-2 border-t border-app-border">
                <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedMovement(m)}>
                  View
                </Button>
              </div>
            </div>
          )}
        />
      </div>

      <Modal
        open={!!selectedMovement}
        onClose={() => setSelectedMovement(null)}
        maxWidth="max-w-lg"
        aria-labelledby="delivery-deduction-detail-title"
      >
        {selectedMovement && (
          <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 id="delivery-deduction-detail-title" className="text-lg font-semibold text-app-fg">
                Delivery deduction
              </h3>
              <button
                type="button"
                onClick={() => setSelectedMovement(null)}
                className="text-app-fg-muted hover:text-app-fg shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <DescriptionList
              items={[
                { label: 'Customer', value: selectedMovement.referenceCustomerName ?? '—' },
                {
                  label: 'Order',
                  value: selectedOrderId ? (
                    <OrderIdBadge id={selectedOrderId} linkTo={`/admin/orders/${selectedOrderId}`} />
                  ) : (
                    '—'
                  ),
                },
                { label: 'Product', value: productName(selectedMovement.productId) },
                { label: 'From', value: locationName(selectedMovement.fromLocationId) },
                { label: 'To', value: locationName(selectedMovement.toLocationId) },
                { label: 'Quantity', value: `-${Math.abs(selectedMovement.quantity)}` },
                {
                  label: 'Date',
                  value: new Date(selectedMovement.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                },
              ]}
            />

            <div className="flex items-center gap-2">
              {selectedOrderId && (
                <Link
                  to={`/admin/orders/${selectedOrderId}`}
                  className="btn-primary btn-sm"
                  onClick={() => setSelectedMovement(null)}
                >
                  Open order
                </Link>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedMovement(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function TransfersTab({
  transfers,
  products,
  locations,
  routeLoaderBusy = false,
}: {
  transfers: Transfer[];
  products: ProductOption[];
  locations: LocationOption[];
  routeLoaderBusy?: boolean;
}) {
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product';
  const locationName = (id: string) => {
    const loc = locations.find((l) => l.id === id);
    if (!loc) return 'Unknown location';
    return loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name;
  };
  const formatRecordedAt = (dateIso: string) =>
    new Date(dateIso).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const columns: CompactTableColumn<Transfer>[] = [
    {
      key: 'product',
      header: 'Product',
      render: (t) => <span className="font-medium text-app-fg">{productName(t.productId)}</span>,
      minWidth: 'min-w-[160px]',
    },
    {
      key: 'from',
      header: 'From',
      render: (t) => <span className="text-app-fg-muted">{locationName(t.fromLocationId)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'to',
      header: 'To',
      render: (t) => <span className="text-app-fg-muted">{locationName(t.toLocationId)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'route',
      header: 'Route',
      className: 'sm:hidden',
      render: (t) => (
        <span className="text-xs text-app-fg-muted">
          {locationName(t.fromLocationId)} → {locationName(t.toLocationId)}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: (t) => (
        <span className="font-medium tabular-nums text-app-fg">{t.quantityReceived ?? t.quantitySent}</span>
      ),
    },
    {
      key: 'recorded',
      header: 'Recorded',
      hideOnMobile: true,
      render: (t) => (
        <span className="text-xs sm:text-sm text-app-fg-muted whitespace-nowrap">
          {formatRecordedAt(t.verifiedAt ?? t.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="card p-4 sm:p-6">
      <CompactTable<Transfer>
        caption="Stock transfers"
        columns={columns}
        rows={transfers}
        rowKey={(t) => t.id}
        loading={routeLoaderBusy}
        loadingVariant="overlay"
        emptyTitle="No transfers yet"
        emptyDescription="Record and manage transfers from Admin → Transfers."
        withCard={false}
        className="overflow-hidden rounded-xl border border-app-border"
      />
    </div>
  );
}

/* ── Returns Tab ── */

function ReturnsTab({
  returnedOrders,
  locationsWithLock,
  fetcher,
}: {
  returnedOrders: ReturnedOrder[];
  locationsWithLock: LocationWithLock[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const [writeOffOrderId, setWriteOffOrderId] = useState<string | null>(null);

  // Close write-off modal on success — edge-triggered via the shared hook.
  // Replaces the prior in-render `if (actionSuccess) setWriteOffOrderId(null)`
  // (a setState-during-render anti-pattern). See CLAUDE.md → "Modal +
  // Optimistic UI Pattern".
  const handleWriteOffSuccess = useCallback(() => {
    setWriteOffOrderId(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleWriteOffSuccess);

  const locationName = useCallback((id: string | null) => {
    if (!id) return '\u2014';
    return locationsWithLock.find((l) => l.id === id)?.name ?? 'Unknown location';
  }, [locationsWithLock]);

  const returnsColumns = useMemo((): CompactTableColumn<ReturnedOrder>[] => [
    {
      key: 'orderId',
      header: 'Order ID',
      render: (order) => <OrderIdBadge id={order.id} textClassName="font-mono text-sm text-app-fg-muted" />,
      minWidth: 'min-w-[120px]',
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (order) => <span className="font-medium text-app-fg">{order.customerName}</span>,
    },
    {
      key: 'location',
      header: 'Location',
      hideOnMobile: true,
      render: (order) => <span className="text-app-fg-muted">{locationName(order.logisticsLocationId)}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (order) => (
        <span className="text-sm text-app-fg-muted max-w-[200px] truncate" title={order.deliveryNotes ?? undefined}>
          {order.deliveryNotes ?? '\u2014'}
        </span>
      ),
      cellTitle: (order) => order.deliveryNotes ?? undefined,
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      render: (order) => (
        <span className="text-app-fg-muted text-sm">
          {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      minWidth: 'min-w-[11rem]',
      mobileShowLabel: false,
      render: (order) => (
        <CompactTableActions className="justify-end shrink-0">
          <fetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="restock" />
            <input type="hidden" name="orderId" value={order.id} />
            <Button
              type="submit"
              variant="success"
              size="sm"
              className="text-xs"
              disabled={fetcher.state === 'submitting'}
              loading={fetcher.state === 'submitting'}
              loadingText="Restocking..."
              title="Mark as sellable — add to local 3PL stock"
            >
              Sellable
            </Button>
          </fetcher.Form>
          <TableActionButton variant="danger" onClick={() => setWriteOffOrderId(order.id)} title="Mark as damaged — write off as operational loss">
            Damaged
          </TableActionButton>
        </CompactTableActions>
      ),
    },
  ], [fetcher.state, locationName]);

  const lockedLocations = locationsWithLock.filter((l) => l.dispatchLocked);

  return (
    <>
      {/* Dispatch Lock Alert */}
      {lockedLocations.length > 0 && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-sm font-semibold text-danger-700 dark:text-danger-400">Dispatch Locked</span>
          </div>
          <p className="text-sm text-danger-600 dark:text-danger-500">
            Dispatch is locked at: {lockedLocations.map((l) => l.name).join(', ')}.
            Resolve pending reconciliations to unlock.
          </p>
        </div>
      )}

      {/* Write-off modal */}
      {writeOffOrderId && (
        <Modal open onClose={() => setWriteOffOrderId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
            <h3 className="text-lg font-semibold text-app-fg">Write Off — Damaged Item</h3>
            <p className="text-sm text-app-fg-muted">This will permanently mark the item as damaged and log it as an Operational Loss.</p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="writeOff" />
              <input type="hidden" name="orderId" value={writeOffOrderId} />
              <Textarea
                label="Damage Note"
                name="reason"
                required
                minLength={10}
                rows={3}
                placeholder="Describe the damage (min 10 characters)..."
              />
              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Writing off...">Write Off</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setWriteOffOrderId(null)}>Cancel</Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Returns table */}
      <div className="card p-0">
        <CompactTable<ReturnedOrder>
          caption="Returned orders"
          columns={returnsColumns}
          rows={returnedOrders}
          rowKey={(order) => order.id}
          withCard={false}
          className="min-w-[860px]"
          emptyTitle="No returned items pending assessment"
          renderMobileCard={(order) => (
            <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-app-fg text-sm">{order.customerName}</span>
                <StatusBadge status="RETURNED" />
              </div>
              <p className="text-sm text-app-fg-muted">
                {locationName(order.logisticsLocationId)} · {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
              </p>
              <div className="flex flex-nowrap items-center gap-2 pt-1 overflow-x-auto">
                <fetcher.Form method="post" className="inline shrink-0">
                  <input type="hidden" name="intent" value="restock" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">Sellable</Button>
                </fetcher.Form>
                <Button variant="danger" size="sm" className="text-xs shrink-0" onClick={() => setWriteOffOrderId(order.id)}>Damaged</Button>
              </div>
            </div>
          )}
        />
      </div>
    </>
  );
}

/* ── Reconciliation Tab ── */

function ReconciliationTab({
  reconciliations,
  products,
  locations,
  locationsWithLock,
  fetcher,
}: {
  reconciliations: Promise<Reconciliation[]> | Reconciliation[];
  products: ProductOption[];
  locations: LocationOption[];
  locationsWithLock: LocationWithLock[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [reconciliationLocationId, setReconciliationLocationId] = useState('');
  const [reconciliationProductId, setReconciliationProductId] = useState('');

  // Close reconciliation modal on success — edge-triggered, replaces the
  // prior in-render `if (actionSuccess) setShowForm(false)` anti-pattern.
  const handleReconciliationSuccess = useCallback(() => {
    setShowForm(false);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleReconciliationSuccess);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Unknown location';
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Unknown product';
  const activeLocations = locationsWithLock.filter((l) => l.status === 'ACTIVE');

  const reconciliationColumns = useMemo((): CompactTableColumn<Reconciliation>[] => [
    {
      key: 'location',
      header: 'Location',
      render: (r) => <span className="font-medium text-app-fg">{locationName(r.locationId)}</span>,
      minWidth: 'min-w-[140px]',
    },
    {
      key: 'product',
      header: 'Product',
      render: (r) => <span className="text-app-fg-muted">{productName(r.productId)}</span>,
    },
    {
      key: 'digital',
      header: 'Digital',
      align: 'right',
      render: (r) => <span className="font-medium">{r.digitalCount}</span>,
    },
    {
      key: 'physical',
      header: 'Physical',
      align: 'right',
      render: (r) => <span className="font-medium">{r.physicalCount}</span>,
    },
    {
      key: 'discrepancy',
      header: 'Discrepancy',
      align: 'right',
      render: (r) => (
        <span
          className={
            r.discrepancy < 0
              ? 'font-bold text-danger-600 dark:text-danger-400'
              : r.discrepancy > 0
                ? 'font-bold text-success-600 dark:text-success-400'
                : 'font-bold'
          }
        >
          {r.discrepancy > 0 ? '+' : ''}
          {r.discrepancy}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => <span className="text-sm">{REASON_LABELS[r.reasonCode] ?? r.reasonCode}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.reconciliationStatus} />,
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      render: (r) => (
        <span className="text-app-fg-muted text-sm">
          {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
  ], [locations, products]);

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
            } else {
              setReconciliationLocationId('');
              setReconciliationProductId('');
              setShowForm(true);
            }
          }}
        >
          {showForm ? 'Close' : '+ Stock Reconciliation'}
        </Button>
      </div>

      {/* Reconciliation Form */}
      <ResponsiveFormPanel
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setReconciliationLocationId('');
          setReconciliationProductId('');
        }}
      >
        <fetcher.Form method="post" className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setReconciliationLocationId('');
                setReconciliationProductId('');
              }}
              className="text-app-fg-muted hover:text-app-fg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createReconciliation" />
          <input type="hidden" name="locationId" value={reconciliationLocationId} />
          <input type="hidden" name="productId" value={reconciliationProductId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SearchableSelect
              id="reconciliation-location"
              label="Location"
              required
              value={reconciliationLocationId}
              onChange={setReconciliationLocationId}
              placeholder="Select location..."
              searchPlaceholder="Search locations..."
              options={activeLocations.map((l) => ({
                value: l.id,
                label: l.name,
                disabled: l.dispatchLocked,
                description: l.dispatchLocked ? 'Dispatch locked' : undefined,
              }))}
            />
            <SearchableSelect
              id="reconciliation-product"
              label="Product"
              required
              value={reconciliationProductId}
              onChange={setReconciliationProductId}
              placeholder="Select product..."
              searchPlaceholder="Search products..."
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
            <TextInput
              label="Physical Count (actual units on shelf)"
              name="physicalCount"
              type="number"
              min={0}
              required
              placeholder="Actual count"
            />
            <FormSelect
              label="Reason Code"
              name="reasonCode"
              required
              options={[
                { value: 'DAMAGED', label: 'Damaged' },
                { value: 'LOST', label: 'Lost' },
                { value: 'EXPIRED', label: 'Expired' },
                { value: 'THEFT', label: 'Suspected Theft' },
                { value: 'COUNTING_ERROR', label: 'Counting Error' },
                { value: 'OTHER', label: 'Other' },
              ]}
            />
          </div>
          <Textarea
            label="Notes (min 10 characters)"
            name="notes"
            rows={2}
            minLength={10}
            placeholder="Describe the discrepancy..."
          />
          <div className="bg-warning-50 dark:bg-warning-700/10 border border-warning-200 dark:border-warning-700/30 rounded-lg px-3 py-2">
            <p className="text-xs text-warning-700 dark:text-warning-400">
              If the physical count differs from the digital record, dispatch will be LOCKED at this location until the reconciliation is approved.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                !reconciliationLocationId ||
                !reconciliationProductId ||
                activeLocations.find((l) => l.id === reconciliationLocationId)?.dispatchLocked === true
              }
              loading={fetcher.state === 'submitting'}
              loadingText="Submitting..."
            >
              Submit Reconciliation
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setReconciliationLocationId('');
                setReconciliationProductId('');
              }}
            >
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Reconciliation Table */}
      <DeferredSection resolve={reconciliations} skeleton="table">
        {(resolved) => {
          const rows = resolved as Reconciliation[];
          return (
            <div className="card p-0">
              <CompactTable<Reconciliation>
                caption="Stock reconciliations"
                columns={reconciliationColumns}
                rows={rows}
                rowKey={(r) => r.id}
                withCard={false}
                className="min-w-[960px]"
                emptyTitle="No reconciliation records"
                emptyDescription="Submit a report when physical stock differs from system records."
                renderMobileCard={(r) => (
                  <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-app-fg text-sm">{locationName(r.locationId)}</span>
                      <StatusBadge status={r.reconciliationStatus} />
                    </div>
                    <p className="text-sm text-app-fg-muted">{productName(r.productId)} · {REASON_LABELS[r.reasonCode] ?? r.reasonCode}</p>
                    <div className="flex gap-4 text-sm">
                      <span>Digital: <strong>{r.digitalCount}</strong></span>
                      <span>Physical: <strong>{r.physicalCount}</strong></span>
                      <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400 font-bold' : 'text-success-600 dark:text-success-400 font-bold'}>
                        {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
                      </span>
                    </div>
                  </div>
                )}
              />
            </div>
          );
        }}
      </DeferredSection>
    </>
  );
}
