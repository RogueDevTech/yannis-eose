import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useFetcher, useNavigation, useSearchParams } from '@remix-run/react';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageHeader } from '~/components/ui/page-header';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import type {
  InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption,
  Transfer, ReturnedOrder, Reconciliation, LocationWithLock, LowStockAlertsResult,
} from './types';
import {
  MOVEMENT_COLORS, formatMovementType,
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

  type TabValue = 'levels' | 'movements' | 'transfers' | 'returns' | 'reconciliation';
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

  // useNavigation: state is 'loading' while the page's loader re-runs after a
  // search-param change. Used to render the inline spinner beside the filters.
  const navigation = useNavigation();
  const isLoadingLevels = navigation.state === 'loading';

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string | null) => id ? (locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…') : '—';

  const displayedLevels = levels;
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

  useEffect(() => {
    if (!showIntakeForm) return;
    if (fetcher.state !== 'idle') return;
    if (!(fetcher.data as { success?: boolean } | undefined)?.success) return;
    setShowIntakeForm(false);
    setIntakeProductId('');
    setIntakeLocationId('');
  }, [fetcher.state, fetcher.data, showIntakeForm]);

  // Low-stock threshold editor (admin-only)
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [draftThreshold, setDraftThreshold] = useState<number>(lowStockThreshold);
  useEffect(() => { setDraftThreshold(lowStockThreshold); }, [lowStockThreshold]);
  const thresholdFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(thresholdFetcher.data, { successMessage: 'Low-stock threshold updated' });
  useEffect(() => {
    if (thresholdFetcher.state === 'idle' && thresholdFetcher.data?.success) {
      setShowThresholdModal(false);
    }
  }, [thresholdFetcher.state, thresholdFetcher.data]);

  const totalStock = levels.reduce((sum, l) => sum + l.stockCount, 0);
  const totalReserved = levels.reduce((sum, l) => sum + l.reservedCount, 0);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        title="Inventory"
        description="Track stock levels, movements, and transfers across all locations"
        actions={
          <>
            <PageRefreshButton />
            <button
              type="button"
              onClick={() => canEditLowStock && setShowThresholdModal(true)}
              disabled={!canEditLowStock}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-app-border bg-app-elevated transition-colors ${
                canEditLowStock ? 'text-app-fg-muted hover:text-app-fg hover:border-app-border-strong cursor-pointer' : 'text-app-fg-muted cursor-default'
              }`}
              title={canEditLowStock ? 'Click to change low-stock alert threshold' : 'Low-stock alert threshold (read-only)'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>
                Alert &lt; <strong className="text-app-fg">{lowStockThreshold}</strong> units
              </span>
            </button>
            {canIntake && (
              <Button
                variant="primary"
                size="sm"
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
                {showIntakeForm ? 'Close' : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Stock Intake
                  </>
                )}
              </Button>
            )}
            {canExport && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowExportModal(true)}
              >
                Export CSV
              </Button>
            )}
          </>
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
                  ? 'Create products and logistics locations first.'
                  : products.length === 0
                    ? 'Create products first via Products → Add Product.'
                    : 'Create logistics locations first via Logistics.'
              }
              actions={
                products.length === 0 && locations.length === 0
                  ? [
                      { label: 'Add Product', href: '/admin/products/new' },
                      { label: 'Go to Logistics', href: '/admin/logistics' },
                    ]
                  : products.length === 0
                    ? [{ label: 'Add Product', href: '/admin/products/new' }]
                    : [{ label: 'Go to Logistics', href: '/admin/logistics' }]
              }
            />
          ) : (
            <fetcher.Form
              key={intakeFormInstance}
              method="post"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <input type="hidden" name="intent" value="stockIntake" />
              <FormSelect
                label="Product"
                id="intake-productId"
                name="productId"
                required
                value={intakeProductId}
                onChange={(e) => setIntakeProductId(e.target.value)}
                placeholder="Select product..."
                options={products.map((p: ProductOption) => ({ value: p.id, label: p.name }))}
                wrapperClassName="sm:col-span-2"
              />
              <FormSelect
                label="Location"
                id="intake-locationId"
                name="locationId"
                required
                value={intakeLocationId}
                onChange={(e) => setIntakeLocationId(e.target.value)}
                placeholder="Select location..."
                options={locations.map((l: LocationOption) => ({ value: l.id, label: l.name }))}
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
                  loading={fetcher.state !== 'idle'}
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

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabValue)}
        tabs={[
          { value: 'levels', label: `Stock Levels (${totalLevels})` },
          { value: 'movements', label: 'Movement Log' },
          ...(hasTransfers ? [{ value: 'transfers' as const, label: `Transfers (${transfers.length})` }] : []),
          ...(hasReturns ? [{ value: 'returns' as const, label: `Returns (${returnedOrders.length})` }] : []),
          ...(reconciliations != null ? [{ value: 'reconciliation' as const, label: 'Reconciliation' }] : []),
        ]}
      />

      {/* Content */}
      {activeTab === 'levels' ? (
        <>
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
                      <Link
                        key={item.levelId}
                        to={`/admin/inventory/${item.levelId}`}
                        prefetch="intent"
                        className="rounded-md border border-warning-200/90 dark:border-warning-800/80 bg-app-elevated/90 dark:bg-warning-950/25 px-2.5 py-2 min-w-0 shadow-sm hover:border-warning-400 dark:hover:border-warning-600 hover:bg-app-elevated dark:hover:bg-warning-950/40 transition-colors"
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

        {/* Filter + search + sort row. Hidden only when there is no data AND no active filter. */}
        {(totalLevels > 0 || currentProductFilter !== 'ALL' || currentLocationFilter !== 'ALL' || currentSort !== 'default' || serverSearch) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <FormSelect
              label=""
              id="levels-product-filter"
              name="productFilter"
              value={currentProductFilter}
              onChange={(e) => updateLevelsParam('productId', e.target.value)}
              wrapperClassName="w-full sm:w-48"
              options={[
                { value: 'ALL', label: 'All products' },
                ...products.map((p: ProductOption) => ({ value: p.id, label: p.name })),
              ]}
              aria-label="Filter by product"
            />
            <FormSelect
              label=""
              id="levels-location-filter"
              name="locationFilter"
              value={currentLocationFilter}
              onChange={(e) => updateLevelsParam('locationId', e.target.value)}
              wrapperClassName="w-full sm:w-48"
              options={[
                { value: 'ALL', label: 'All locations' },
                ...locations.map((l: LocationOption) => ({ value: l.id, label: l.name })),
              ]}
              aria-label="Filter by location"
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
            {isLoadingLevels && (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-app-fg-muted shrink-0"
                aria-live="polite"
              >
                <svg
                  className="w-3.5 h-3.5 animate-spin text-brand-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">Loading…</span>
              </span>
            )}
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
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Product</th>
                  <th className="table-header">Location</th>
                  <th className="table-header text-right">Stock</th>
                  <th className="table-header text-right">Reserved</th>
                  <th className="table-header text-right">Available</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Last Updated</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedLevels.map((level) => (
                  <tr key={level.id} className="table-row">
                    <td className="table-cell font-medium text-app-fg">{productName(level.productId)}</td>
                    <td className="table-cell text-app-fg-muted">{locationName(level.locationId)}</td>
                    <td className="table-cell text-right font-medium">{level.stockCount}</td>
                    <td className="table-cell text-right text-warning-600 dark:text-warning-400">{level.reservedCount}</td>
                    <td className="table-cell text-right font-medium text-success-600 dark:text-success-400">
                      {level.stockCount - level.reservedCount}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={level.status} />
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {new Date(level.updatedAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="table-cell text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <Link
                          to={`/admin/inventory/${level.id}`}
                          prefetch="intent"
                          className="btn-primary btn-sm text-xs inline-flex items-center justify-center"
                        >
                          View
                        </Link>
                        {canAdjust && (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="text-xs"
                              onClick={() => openAdjustModal(level, 'decrease')}
                            >
                              Remove stock
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="text-xs"
                              onClick={() => openAdjustModal(level, 'increase')}
                            >
                              Add units
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {displayedLevels.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        title={levels.length === 0 ? 'No inventory data yet' : 'No inventory matches your filter'}
                        description={levels.length === 0 ? 'Add products and receive stock to get started.' : 'Try changing the product filter or sort.'}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3 px-1">
            {displayedLevels.map((level) => (
              <div
                key={level.id}
                className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm text-app-fg">{productName(level.productId)}</p>
                    <p className="text-sm text-app-fg-muted">{locationName(level.locationId)}</p>
                  </div>
                  <StatusBadge status={level.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-app-fg-muted">Stock</p>
                    <p className="font-medium text-app-fg">{level.stockCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-app-fg-muted">Reserved</p>
                    <p className="font-medium text-warning-600 dark:text-warning-400">{level.reservedCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-app-fg-muted">Available</p>
                    <p className="font-medium text-success-600 dark:text-success-400">{level.stockCount - level.reservedCount}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-app-border">
                  <Link
                    to={`/admin/inventory/${level.id}`}
                    prefetch="intent"
                    className="btn-primary btn-sm"
                  >
                    View
                  </Link>
                  {canAdjust && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openAdjustModal(level, 'decrease')}
                      >
                        Remove stock
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openAdjustModal(level, 'increase')}
                      >
                        Add units
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {displayedLevels.length === 0 && (
              <EmptyState
                title={
                  totalLevels === 0 && currentProductFilter === 'ALL' && currentLocationFilter === 'ALL' && !serverSearch && currentSort === 'default'
                    ? 'No inventory data yet'
                    : 'No inventory matches your filter'
                }
              />
            )}
          </div>
        </div>

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
      ) : (
        <DeferredSection resolve={movements} skeleton="table">
          {(resolvedMovements) => (
            <div className="card p-0 overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Type</th>
                      <th className="table-header">Product</th>
                      <th className="table-header text-right">Quantity</th>
                      <th className="table-header">From</th>
                      <th className="table-header">To</th>
                      <th className="table-header">Reason</th>
                      <th className="table-header">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedMovements.map((m: StockMovement) => (
                      <tr key={m.id} className="table-row">
                        <td className="table-cell">
                          <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                            {formatMovementType(m.movementType)}
                          </span>
                        </td>
                        <td className="table-cell font-medium text-app-fg">{productName(m.productId)}</td>
                        <td className="table-cell text-right font-medium">
                          <span className={m.quantity > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}>
                            {m.quantity > 0 ? '+' : ''}{m.quantity}
                          </span>
                        </td>
                        <td className="table-cell text-app-fg-muted">
                          {locationName(m.fromLocationId)}
                        </td>
                        <td className="table-cell text-app-fg-muted">
                          {locationName(m.toLocationId)}
                        </td>
                        <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">
                          {m.reason ?? '\u2014'}
                        </td>
                        <td className="table-cell text-app-fg-muted">
                          {new Date(m.createdAt).toLocaleDateString('en-NG', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                    {resolvedMovements.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState title="No stock movements recorded yet" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-3 px-1">
                {resolvedMovements.map((m: StockMovement) => (
                  <div key={m.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                        {formatMovementType(m.movementType)}
                      </span>
                      <span className={`font-medium ${m.quantity > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                        {m.quantity > 0 ? '+' : ''}{m.quantity} units
                      </span>
                    </div>
                    <p className="text-sm font-medium text-app-fg mb-0.5">{productName(m.productId)}</p>
                    <p className="text-sm text-app-fg-muted">
                      {locationName(m.fromLocationId)} {m.fromLocationId && m.toLocationId ? '→' : ''} {locationName(m.toLocationId)}
                    </p>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      {new Date(m.createdAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                      {m.reason && ` — ${m.reason}`}
                    </p>
                  </div>
                ))}
                {resolvedMovements.length === 0 && (
                  <EmptyState title="No stock movements yet" />
                )}
              </div>
            </div>
          )}
        </DeferredSection>
      )}

      {activeTab === 'transfers' && hasTransfers && (
        <TransfersTab transfers={transfers} products={products} locations={locations} />
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

function TransfersTab({
  transfers,
  products,
  locations,
}: {
  transfers: Transfer[];
  products: ProductOption[];
  locations: LocationOption[];
}) {
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <div className="card p-0 overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-sm text-app-fg-muted">
        Read-only list. Use <span className="text-app-fg">Admin → Transfers</span> to record a movement.
      </p>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Product</th>
              <th className="table-header">From</th>
              <th className="table-header">To</th>
              <th className="table-header text-right">Qty</th>
              <th className="table-header">Recorded</th>
              <th className="table-header w-0"> </th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => {
              const legacy = t.transferStatus && t.transferStatus !== 'RECEIVED';
              return (
                <tr key={t.id} className="table-row">
                  <td className="table-cell font-medium text-app-fg">{productName(t.productId)}</td>
                  <td className="table-cell text-app-fg-muted">{locationName(t.fromLocationId)}</td>
                  <td className="table-cell text-app-fg-muted">{locationName(t.toLocationId)}</td>
                  <td className="table-cell text-right font-medium">
                    {t.transferStatus === 'DISPUTED' && t.quantityReceived !== null
                      ? `${t.quantityReceived} / ${t.quantitySent}`
                      : t.quantityReceived ?? t.quantitySent}
                  </td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {t.verifiedAt
                      ? new Date(t.verifiedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : new Date(t.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="table-cell text-xs text-app-fg-muted max-w-[8rem]">
                    {legacy && t.transferStatus === 'IN_TRANSIT' && 'Legacy: awaiting completion'}
                    {legacy && t.transferStatus === 'DISPUTED' && t.shrinkageReason ? `Discrepancy: ${t.shrinkageReason}` : null}
                  </td>
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No transfers" description="No transfer records for your scope." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3 px-1 pb-3">
        {transfers.map((t) => {
          const legacy = t.transferStatus && t.transferStatus !== 'RECEIVED';
          return (
            <div key={t.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
              <div className="font-medium text-app-fg text-sm">{productName(t.productId)}</div>
              <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                <span>{locationName(t.fromLocationId)}</span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                <span>{locationName(t.toLocationId)}</span>
              </div>
              <p className="text-sm text-app-fg">
                Qty:{' '}
                <span className="font-medium">
                  {t.transferStatus === 'DISPUTED' && t.quantityReceived !== null
                    ? `${t.quantityReceived} / ${t.quantitySent}`
                    : t.quantityReceived ?? t.quantitySent}
                </span>
              </p>
              <p className="text-xs text-app-fg-muted">
                {t.verifiedAt
                  ? new Date(t.verifiedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : new Date(t.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
              {legacy && t.transferStatus === 'IN_TRANSIT' && (
                <p className="text-xs text-warning-600 dark:text-warning-400">Legacy: awaiting completion</p>
              )}
              {legacy && t.transferStatus === 'DISPUTED' && t.shrinkageReason && (
                <p className="text-xs text-danger-600 dark:text-danger-400">Discrepancy: {t.shrinkageReason}</p>
              )}
            </div>
          );
        })}
        {transfers.length === 0 && <EmptyState title="No transfers" />}
      </div>
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

  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  if (actionSuccess && writeOffOrderId) setWriteOffOrderId(null);

  const locationName = (id: string | null) => {
    if (!id) return '\u2014';
    return locationsWithLock.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…';
  };

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
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Location</th>
                <th className="table-header">Notes</th>
                <th className="table-header">Date</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {returnedOrders.map((order) => (
                <tr key={order.id} className="table-row">
                  <td className="table-cell"><OrderIdBadge id={order.id} textClassName="font-mono text-sm text-app-fg-muted" /></td>
                  <td className="table-cell font-medium text-app-fg">{order.customerName}</td>
                  <td className="table-cell text-app-fg-muted">{locationName(order.logisticsLocationId)}</td>
                  <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">{order.deliveryNotes ?? '\u2014'}</td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1.5">
                      <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="restock" />
                        <input type="hidden" name="orderId" value={order.id} />
                        <Button type="submit" variant="success" size="sm" className="text-xs" disabled={fetcher.state === 'submitting'} loading={fetcher.state === 'submitting'} loadingText="Restocking..." title="Mark as sellable — add to local 3PL stock">Sellable</Button>
                      </fetcher.Form>
                      <Button variant="danger" size="sm" className="text-xs" onClick={() => setWriteOffOrderId(order.id)} title="Mark as damaged — write off as operational loss">Damaged</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {returnedOrders.length === 0 && (
                <tr><td colSpan={6}><EmptyState title="No returned items pending assessment" /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3 px-1">
          {returnedOrders.map((order) => (
            <div key={order.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-app-fg text-sm">{order.customerName}</span>
                <StatusBadge status="RETURNED" />
              </div>
              <p className="text-sm text-app-fg-muted">
                {locationName(order.logisticsLocationId)} · {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
              </p>
              <div className="flex gap-2 pt-1">
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="restock" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">Sellable</Button>
                </fetcher.Form>
                <Button variant="danger" size="sm" className="text-xs" onClick={() => setWriteOffOrderId(order.id)}>Damaged</Button>
              </div>
            </div>
          ))}
          {returnedOrders.length === 0 && <EmptyState title="No returned items pending assessment" />}
        </div>
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

  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  if (actionSuccess && showForm) setShowForm(false);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…';
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const activeLocations = locationsWithLock.filter((l) => l.status === 'ACTIVE');

  return (
    <>
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Close' : '+ Stock Reconciliation'}
        </Button>
      </div>

      {/* Reconciliation Form */}
      <ResponsiveFormPanel open={showForm} onClose={() => setShowForm(false)}>
        <fetcher.Form method="post" className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createReconciliation" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormSelect
              label="Location"
              name="locationId"
              required
              placeholder="Select location..."
              options={activeLocations.map((l) => ({
                value: l.id,
                label: `${l.name}${l.dispatchLocked ? ' (LOCKED)' : ''}`,
              }))}
            />
            <FormSelect
              label="Product"
              name="productId"
              required
              placeholder="Select product..."
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
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Submitting...">Submit Reconciliation</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Reconciliation Table */}
      <DeferredSection resolve={reconciliations} skeleton="table">
        {(resolved) => (
          <div className="card p-0 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Location</th>
                    <th className="table-header">Product</th>
                    <th className="table-header text-right">Digital</th>
                    <th className="table-header text-right">Physical</th>
                    <th className="table-header text-right">Discrepancy</th>
                    <th className="table-header">Reason</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(resolved as Reconciliation[]).map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="table-cell font-medium text-app-fg">{locationName(r.locationId)}</td>
                      <td className="table-cell text-app-fg-muted">{productName(r.productId)}</td>
                      <td className="table-cell text-right font-medium">{r.digitalCount}</td>
                      <td className="table-cell text-right font-medium">{r.physicalCount}</td>
                      <td className="table-cell text-right font-bold">
                        <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400' : r.discrepancy > 0 ? 'text-success-600 dark:text-success-400' : ''}>
                          {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
                        </span>
                      </td>
                      <td className="table-cell text-sm">{REASON_LABELS[r.reasonCode] ?? r.reasonCode}</td>
                      <td className="table-cell"><StatusBadge status={r.reconciliationStatus} /></td>
                      <td className="table-cell text-app-fg-muted text-sm">
                        {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                  {(resolved as Reconciliation[]).length === 0 && (
                    <tr><td colSpan={8}><EmptyState title="No reconciliation records" description="Submit a report when physical stock differs from system records." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3 px-1">
              {(resolved as Reconciliation[]).map((r) => (
                <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
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
              ))}
              {(resolved as Reconciliation[]).length === 0 && (
                <EmptyState title="No reconciliation records" />
              )}
            </div>
          </div>
        )}
      </DeferredSection>
    </>
  );
}
