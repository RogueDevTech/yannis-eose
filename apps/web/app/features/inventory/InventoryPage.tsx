import { useState, useEffect, useRef } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { exportToCsv } from '~/lib/csv-export';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageHeader } from '~/components/ui/page-header';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import type {
  InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption,
  Transfer, ReturnedOrder, Reconciliation, LocationWithLock,
} from './types';
import {
  MOVEMENT_COLORS, formatMovementType,
  REASON_LABELS,
} from './types';

export function InventoryPage({
  levels, totalLevels, levelsPage = 1, levelsTotalPages = 1, levelsLimit = 20,
  levelsProductFilter: serverProductFilter = '', levelsSort: serverSort = 'default',
  movements, totalMovements, products, locations, canIntake = false, canExport = false,
  transfers, returnedOrders, reconciliations, locationsWithLock,
}: InventoryStreamData) {
  const hasTransfers = !!transfers;
  const hasReturns = !!returnedOrders;

  type TabValue = 'levels' | 'movements' | 'transfers' | 'returns' | 'reconciliation';
  const [activeTab, setActiveTab] = useState<TabValue>('levels');

  // Stock Levels filter + sort are URL-driven so the backend can do the actual filter/sort/paginate.
  // `levelsProductFilter` empty string = no filter (backend default).
  type LevelsSort = 'default' | 'lowestAvailable' | 'highestAvailable';
  const [searchParams, setSearchParams] = useSearchParams();

  const updateLevelsParam = (key: 'productId' | 'sort', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'ALL' || value === 'default') next.delete(key);
      else next.set(key, value);
      // Any filter/sort change resets to page 1.
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const resetLevelsFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('productId');
      next.delete('sort');
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string | null) => id ? (locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…') : '—';

  const displayedLevels = levels;
  const currentProductFilter = serverProductFilter || 'ALL';
  const currentSort: LevelsSort = serverSort;
  const [showIntakeForm, setShowIntakeForm] = useState(false);

  // Detail drawer: opened by clicking a level row. Loads movement history via the
  // /admin/inventory/level-detail resource route (debounced by useFetcher.load).
  const [selectedLevel, setSelectedLevel] = useState<InventoryLevel | null>(null);
  const detailFetcher = useFetcher<{ movements: StockMovement[]; total: number }>();

  useEffect(() => {
    if (!selectedLevel) return;
    const q = new URLSearchParams({
      productId: selectedLevel.productId,
      locationId: selectedLevel.locationId,
    });
    detailFetcher.load(`/admin/inventory/level-detail?${q.toString()}`);
    // detailFetcher ref is stable; intentionally not in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLevel?.id]);

  const fetcher = useFetcher();

  const intakeError = (fetcher.data as { error?: string } | undefined)?.error;
  const intakeSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
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

  if (intakeSuccess && showIntakeForm) setShowIntakeForm(false);

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
            {canIntake && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowIntakeForm(!showIntakeForm)}
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
                onClick={() => exportToCsv(
                  levels.map((inv) => ({
                    product: productName(inv.productId),
                    location: locationName(inv.locationId),
                    stock: inv.stockCount,
                    reserved: inv.reservedCount,
                    available: inv.stockCount - inv.reservedCount,
                    status: inv.status,
                    updated: new Date(inv.updatedAt).toLocaleDateString(),
                  })),
                  [
                    { key: 'product', label: 'Product' },
                    { key: 'location', label: 'Location' },
                    { key: 'stock', label: 'Stock Count' },
                    { key: 'reserved', label: 'Reserved' },
                    { key: 'available', label: 'Available' },
                    { key: 'status', label: 'Status' },
                    { key: 'updated', label: 'Last Updated' },
                  ],
                  `inventory-${new Date().toISOString().split('T')[0]}.csv`,
                )}
              >
                Export CSV
              </Button>
            )}
          </>
        }
      />

      {/* Stock Intake modal (only when user has inventory.intake) */}
      {canIntake && showIntakeForm && (
        <Modal
          open
          onClose={() => setShowIntakeForm(false)}
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
              onClick={() => setShowIntakeForm(false)}
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
            <fetcher.Form method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input type="hidden" name="intent" value="stockIntake" />
              <FormSelect
                label="Product"
                id="intake-productId"
                name="productId"
                required
                placeholder="Select product..."
                options={products.map((p: ProductOption) => ({ value: p.id, label: p.name }))}
                wrapperClassName="sm:col-span-2"
              />
              <FormSelect
                label="Location"
                id="intake-locationId"
                name="locationId"
                required
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
                <Button type="button" variant="secondary" onClick={() => setShowIntakeForm(false)}>
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

      {/* Stock Level detail drawer — shows movement history for a clicked (product, location). */}
      {selectedLevel && (
        <Modal
          open
          onClose={() => setSelectedLevel(null)}
          maxWidth="max-w-3xl"
          contentClassName="p-0 max-h-[85dvh] overflow-hidden flex flex-col bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-app-border shrink-0">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-app-fg truncate">
                {productName(selectedLevel.productId)}
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5 truncate">
                {locationName(selectedLevel.locationId)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedLevel(null)}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Current snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b border-app-border shrink-0">
            <div>
              <p className="text-xs text-app-fg-muted">Stock</p>
              <p className="text-lg font-semibold text-app-fg">{selectedLevel.stockCount}</p>
            </div>
            <div>
              <p className="text-xs text-app-fg-muted">Reserved</p>
              <p className="text-lg font-semibold text-warning-600 dark:text-warning-400">{selectedLevel.reservedCount}</p>
            </div>
            <div>
              <p className="text-xs text-app-fg-muted">Available</p>
              <p className="text-lg font-semibold text-success-600 dark:text-success-400">
                {selectedLevel.stockCount - selectedLevel.reservedCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-app-fg-muted">Status</p>
              <div className="mt-1"><StatusBadge status={selectedLevel.status} /></div>
            </div>
          </div>

          {/* Movement history */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-6 py-4">
              <h4 className="text-sm font-semibold text-app-fg mb-3">Movement history</h4>
              {detailFetcher.state !== 'idle' && !detailFetcher.data ? (
                <p className="text-sm text-app-fg-muted">Loading history…</p>
              ) : (detailFetcher.data?.movements ?? []).length === 0 ? (
                <EmptyState title="No movements yet" description="Stock intakes, transfers, and other events will appear here." />
              ) : (
                <ul className="space-y-2">
                  {(detailFetcher.data?.movements ?? []).map((m) => {
                    const isIncoming =
                      m.movementType === 'INTAKE' ||
                      m.movementType === 'TRANSFER_IN' ||
                      m.movementType === 'RESTOCK' ||
                      (m.movementType === 'ADJUSTMENT' && m.quantity > 0);
                    const arrow = (m.fromLocationId || m.toLocationId)
                      ? `${locationName(m.fromLocationId)} → ${locationName(m.toLocationId)}`
                      : null;
                    return (
                      <li
                        key={m.id}
                        className="rounded-lg border border-app-border bg-app-canvas px-3 py-2.5 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                              {formatMovementType(m.movementType)}
                            </span>
                            <span className={`font-medium ${isIncoming ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                              {isIncoming ? '+' : ''}{m.quantity}
                            </span>
                          </div>
                          <span className="text-xs text-app-fg-muted whitespace-nowrap">
                            {new Date(m.createdAt).toLocaleString('en-NG', {
                              month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {arrow && (
                          <p className="text-xs text-app-fg-muted mt-1 truncate">{arrow}</p>
                        )}
                        {m.reason && (
                          <p className="text-xs text-app-fg-muted mt-1 italic">{m.reason}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {detailFetcher.data && detailFetcher.data.total > detailFetcher.data.movements.length && (
                <p className="text-xs text-app-fg-muted mt-3">
                  Showing latest {detailFetcher.data.movements.length} of {detailFetcher.data.total} movements.
                </p>
              )}
            </div>
          </div>
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
        {/* Filter + sort row — always render the filter so it stays visible when an empty filter
            returns zero rows. Hide it only when there is no data AND no active filter. */}
        {(totalLevels > 0 || currentProductFilter !== 'ALL' || currentSort !== 'default') && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <FormSelect
              label=""
              id="levels-product-filter"
              name="productFilter"
              value={currentProductFilter}
              onChange={(e) => updateLevelsParam('productId', e.target.value)}
              wrapperClassName="w-full sm:w-64"
              options={[
                { value: 'ALL', label: 'All products' },
                ...products.map((p: ProductOption) => ({ value: p.id, label: p.name })),
              ]}
              aria-label="Filter by product"
            />
            <FormSelect
              label=""
              id="levels-sort"
              name="levelsSort"
              value={currentSort}
              onChange={(e) => updateLevelsParam('sort', e.target.value)}
              wrapperClassName="w-full sm:w-56"
              options={[
                { value: 'default', label: 'Default order' },
                { value: 'lowestAvailable', label: 'Lowest available first' },
                { value: 'highestAvailable', label: 'Highest available first' },
              ]}
              aria-label="Sort order"
            />
            {(currentProductFilter !== 'ALL' || currentSort !== 'default') && (
              <button
                type="button"
                onClick={resetLevelsFilters}
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline self-center"
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
                </tr>
              </thead>
              <tbody>
                {displayedLevels.map((level) => (
                  <tr
                    key={level.id}
                    className="table-row cursor-pointer hover:bg-app-hover/60"
                    onClick={() => setSelectedLevel(level)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedLevel(level);
                      }
                    }}
                    aria-label={`View history for ${productName(level.productId)} at ${locationName(level.locationId)}`}
                  >
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
                  </tr>
                ))}
                {displayedLevels.length === 0 && (
                  <tr>
                    <td colSpan={7}>
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
              <button
                key={level.id}
                type="button"
                onClick={() => setSelectedLevel(level)}
                className="w-full text-left rounded-lg border border-app-border bg-app-elevated p-4 space-y-3 hover:bg-app-hover/60 active:scale-[0.99] transition"
                aria-label={`View history for ${productName(level.productId)} at ${locationName(level.locationId)}`}
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
              </button>
            ))}
            {displayedLevels.length === 0 && (
              <EmptyState title={totalLevels === 0 && currentProductFilter === 'ALL' ? 'No inventory data yet' : 'No inventory matches your filter'} />
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
        <TransfersTab
          transfers={transfers}
          products={products}
          locations={locations}
          fetcher={fetcher}
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

function TransfersTab({
  transfers,
  products,
  locations,
  fetcher,
}: {
  transfers: Transfer[];
  products: ProductOption[];
  locations: LocationOption[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const [verifyingTransfer, setVerifyingTransfer] = useState<Transfer | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'IN_TRANSIT' | 'RECEIVED' | 'DISPUTED'>('all');

  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  if (actionSuccess && verifyingTransfer) setVerifyingTransfer(null);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…';

  const filtered = statusFilter === 'all' ? transfers : transfers.filter((t) => t.transferStatus === statusFilter);
  const inTransitCount = transfers.filter((t) => t.transferStatus === 'IN_TRANSIT').length;

  return (
    <>
      {/* Verify Transfer Modal */}
      {verifyingTransfer && (
        <Modal open onClose={() => setVerifyingTransfer(null)} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 bg-app-elevated">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-app-fg">Verify Transfer Delivery</h3>
              <button onClick={() => setVerifyingTransfer(null)} className="text-app-fg-muted hover:text-app-fg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-app-hover rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">Product</span>
                <span className="font-medium text-app-fg">{productName(verifyingTransfer.productId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">From</span>
                <span className="font-medium text-app-fg">{locationName(verifyingTransfer.fromLocationId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">To</span>
                <span className="font-medium text-app-fg">{locationName(verifyingTransfer.toLocationId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">Quantity Sent</span>
                <span className="font-bold text-app-fg">{verifyingTransfer.quantitySent} units</span>
              </div>
            </div>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="verifyTransfer" />
              <input type="hidden" name="transferId" value={verifyingTransfer.id} />
              <TextInput
                label="Quantity Actually Received"
                name="quantityReceived"
                type="number"
                min={0}
                max={verifyingTransfer.quantitySent}
                required
                defaultValue={verifyingTransfer.quantitySent}
                hint={`If less than ${verifyingTransfer.quantitySent}, a shrinkage alert will be sent to the CEO and Head of Logistics`}
              />
              <FormSelect
                label="Shrinkage Reason (if qty differs)"
                name="shrinkageReason"
                options={[
                  { value: '', label: 'N/A — full quantity received' },
                  { value: 'DAMAGED', label: 'Damaged in transit' },
                  { value: 'LOST', label: 'Lost during shipping' },
                  { value: 'EXPIRED', label: 'Expired product' },
                  { value: 'THEFT', label: 'Suspected theft' },
                  { value: 'COUNTING_ERROR', label: 'Counting error at source' },
                  { value: 'OTHER', label: 'Other' },
                ]}
              />
              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Verifying...">Confirm Delivery</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setVerifyingTransfer(null)}>Cancel</Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        {([['all', 'All'], ['IN_TRANSIT', `In Transit (${inTransitCount})`], ['RECEIVED', 'Received'], ['DISPUTED', 'Disputed']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === val
                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                : 'bg-app-elevated border-app-border text-app-fg-muted hover:border-app-border'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Transfers Table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Product</th>
                <th className="table-header">From</th>
                <th className="table-header">To</th>
                <th className="table-header text-right">Sent</th>
                <th className="table-header text-right">Received</th>
                <th className="table-header">Status</th>
                <th className="table-header">Date</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const shrinkage = t.quantityReceived !== null ? t.quantitySent - t.quantityReceived : 0;
                return (
                  <tr key={t.id} className="table-row">
                    <td className="table-cell font-medium text-app-fg">{productName(t.productId)}</td>
                    <td className="table-cell text-app-fg-muted">{locationName(t.fromLocationId)}</td>
                    <td className="table-cell text-app-fg-muted">{locationName(t.toLocationId)}</td>
                    <td className="table-cell text-right font-medium">{t.quantitySent}</td>
                    <td className="table-cell text-right font-medium">
                      {t.quantityReceived !== null ? (
                        <span className={shrinkage > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}>
                          {t.quantityReceived}{shrinkage > 0 && <span className="text-xs ml-1">(-{shrinkage})</span>}
                        </span>
                      ) : <span className="text-app-fg-muted">{'\u2014'}</span>}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={t.transferStatus} />
                    </td>
                    <td className="table-cell text-app-fg-muted text-sm">
                      {new Date(t.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="table-cell">
                      {t.transferStatus === 'IN_TRANSIT' && (
                        <Button variant="primary" size="sm" className="text-xs" onClick={() => setVerifyingTransfer(t)}>Verify Delivery</Button>
                      )}
                      {t.transferStatus === 'DISPUTED' && t.shrinkageReason && (
                        <span className="text-xs text-danger-600 dark:text-danger-400" title={t.shrinkageReason}>{t.shrinkageReason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8}><EmptyState title="No transfers found" /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3 px-1">
          {filtered.map((t) => {
            const shrinkage = t.quantityReceived !== null ? t.quantitySent - t.quantityReceived : 0;
            return (
              <div key={t.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-app-fg text-sm">{productName(t.productId)}</span>
                  <StatusBadge status={t.transferStatus} />
                </div>
                <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                  <span>{locationName(t.fromLocationId)}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  <span>{locationName(t.toLocationId)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex gap-4">
                    <span>Sent: <span className="font-medium text-app-fg">{t.quantitySent}</span></span>
                    {t.quantityReceived !== null && (
                      <span>Recv: <span className={`font-medium ${shrinkage > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{t.quantityReceived}</span></span>
                    )}
                  </div>
                  {t.transferStatus === 'IN_TRANSIT' && (
                    <Button variant="primary" size="sm" className="text-xs" onClick={() => setVerifyingTransfer(t)}>Verify</Button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <EmptyState title="No transfers found" />}
        </div>
      </div>
    </>
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
                  <td className="table-cell font-mono text-sm">{order.id.slice(0, 8)}...</td>
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
