import { useState, useEffect, useRef } from 'react';
import { useFetcher } from '@remix-run/react';
import { exportToCsv } from '~/lib/csv-export';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { InlineNotification } from '~/components/ui/inline-notification';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import type {
  InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption,
  Transfer, ReturnedOrder, Reconciliation, LocationWithLock,
} from './types';
import {
  MOVEMENT_COLORS, formatMovementType,
  TRANSFER_STATUS_BADGE, RECON_STATUS_BADGE, REASON_LABELS,
} from './types';

export function InventoryPage({
  levels, totalLevels, movements, totalMovements, products, locations, canIntake = false,
  transfers, returnedOrders, reconciliations, locationsWithLock,
}: InventoryStreamData) {
  const hasTransfers = !!transfers;
  const hasReturns = !!returnedOrders;

  type TabValue = 'levels' | 'movements' | 'transfers' | 'returns' | 'reconciliation';
  const [activeTab, setActiveTab] = useState<TabValue>('levels');

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string | null) => id ? (locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…') : '—';
  const [showIntakeForm, setShowIntakeForm] = useState(false);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Inventory</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Track stock levels, movements, and transfers across all locations
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Stock Intake form (only when user has inventory.intake) */}
      {canIntake && (
        <ResponsiveFormPanel open={showIntakeForm} onClose={() => setShowIntakeForm(false)}>
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Receive Stock (Stock Intake)</h3>
              <button
                type="button"
                onClick={() => setShowIntakeForm(false)}
                className="p-1.5 rounded-lg text-surface-600 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-surface-700 dark:text-surface-200">
              Add a new FIFO batch. Each intake creates a batch with its own factory and landing cost. Requires Warehouse Manager or SuperAdmin role.
            </p>
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
            <fetcher.Form method="post" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <input type="hidden" name="intent" value="stockIntake" />
              <div>
                <label htmlFor="intake-productId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Product
                </label>
                <select
                  id="intake-productId"
                  name="productId"
                  required
                  className="input"
                >
                  <option value="">Select product...</option>
                  {products.map((p: ProductOption) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="intake-locationId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Location
                </label>
                <select
                  id="intake-locationId"
                  name="locationId"
                  required
                  className="input"
                >
                  <option value="">Select location...</option>
                  {locations.map((l: LocationOption) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="intake-quantity" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Quantity
                </label>
                <input
                  id="intake-quantity"
                  name="quantity"
                  type="number"
                  required
                  min={1}
                  className="input"
                  placeholder="0"
                />
              </div>
              <div>
                <label htmlFor="intake-factoryCost" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
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
              <div>
                <label htmlFor="intake-landingCost" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Landing Cost (&#8358;)
                </label>
                <AmountInput
                  id="intake-landingCost"
                  name="landingCost"
                  className="input"
                  placeholder="0.00"
                  defaultValue="0"
                />
                <p className="text-xs text-surface-600 dark:text-surface-300 mt-0.5">
                  Freight, duty, etc. Default 0.
                </p>
              </div>
              <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
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
          </div>
        </ResponsiveFormPanel>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Stock</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalStock.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Reserved</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{totalReserved.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Available</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{(totalStock - totalReserved).toLocaleString()}</p>
        </div>
        <DeferredSection resolve={totalMovements} skeleton="stat">
          {(count) => (
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Movements</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{count}</p>
            </div>
          )}
        </DeferredSection>
      </div>

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
                {levels.map((level) => (
                  <tr key={level.id} className="table-row">
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{productName(level.productId)}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">{locationName(level.locationId)}</td>
                    <td className="table-cell text-right font-medium">{level.stockCount}</td>
                    <td className="table-cell text-right text-warning-600 dark:text-warning-400">{level.reservedCount}</td>
                    <td className="table-cell text-right font-medium text-success-600 dark:text-success-400">
                      {level.stockCount - level.reservedCount}
                    </td>
                    <td className="table-cell">
                      <span className="badge-success">{level.status}</span>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">
                      {new Date(level.updatedAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
                {levels.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                      No inventory data yet. Add products and receive stock to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
            {levels.map((level) => (
              <div key={level.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm text-surface-900 dark:text-white">{productName(level.productId)}</p>
                    <p className="text-xs text-surface-600 dark:text-surface-400">{locationName(level.locationId)}</p>
                  </div>
                  <span className="badge-success">{level.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-surface-700 dark:text-surface-300">Stock</p>
                    <p className="font-medium text-surface-900 dark:text-white">{level.stockCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-700 dark:text-surface-300">Reserved</p>
                    <p className="font-medium text-warning-600 dark:text-warning-400">{level.reservedCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-surface-700 dark:text-surface-300">Available</p>
                    <p className="font-medium text-success-600 dark:text-success-400">{level.stockCount - level.reservedCount}</p>
                  </div>
                </div>
              </div>
            ))}
            {levels.length === 0 && (
              <div className="p-8 text-center text-surface-700 dark:text-surface-300">
                No inventory data yet
              </div>
            )}
          </div>
        </div>
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
                        <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{productName(m.productId)}</td>
                        <td className="table-cell text-right font-medium">
                          <span className={m.quantity > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}>
                            {m.quantity > 0 ? '+' : ''}{m.quantity}
                          </span>
                        </td>
                        <td className="table-cell text-surface-800 dark:text-surface-200">
                          {locationName(m.fromLocationId)}
                        </td>
                        <td className="table-cell text-surface-800 dark:text-surface-200">
                          {locationName(m.toLocationId)}
                        </td>
                        <td className="table-cell text-sm text-surface-800 dark:text-surface-200 max-w-[200px] truncate">
                          {m.reason ?? '\u2014'}
                        </td>
                        <td className="table-cell text-surface-800 dark:text-surface-200">
                          {new Date(m.createdAt).toLocaleDateString('en-NG', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                    {resolvedMovements.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                          No stock movements recorded yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                {resolvedMovements.map((m: StockMovement) => (
                  <div key={m.id} className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                        {formatMovementType(m.movementType)}
                      </span>
                      <span className={`font-medium ${m.quantity > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                        {m.quantity > 0 ? '+' : ''}{m.quantity} units
                      </span>
                    </div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white mb-0.5">{productName(m.productId)}</p>
                    <p className="text-xs text-surface-600 dark:text-surface-400">
                      {locationName(m.fromLocationId)} {m.fromLocationId && m.toLocationId ? '→' : ''} {locationName(m.toLocationId)}
                    </p>
                    <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                      {new Date(m.createdAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                      {m.reason && ` — ${m.reason}`}
                    </p>
                  </div>
                ))}
                {resolvedMovements.length === 0 && (
                  <div className="p-8 text-center text-surface-700 dark:text-surface-300">
                    No stock movements yet
                  </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setVerifyingTransfer(null)} />
          <div className="relative bg-white dark:bg-surface-800 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Verify Transfer Delivery</h3>
              <button onClick={() => setVerifyingTransfer(null)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-surface-50 dark:bg-surface-700/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">Product</span>
                <span className="font-medium text-surface-900 dark:text-white">{productName(verifyingTransfer.productId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">From</span>
                <span className="font-medium text-surface-900 dark:text-white">{locationName(verifyingTransfer.fromLocationId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">To</span>
                <span className="font-medium text-surface-900 dark:text-white">{locationName(verifyingTransfer.toLocationId)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">Quantity Sent</span>
                <span className="font-bold text-surface-900 dark:text-white">{verifyingTransfer.quantitySent} units</span>
              </div>
            </div>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="verifyTransfer" />
              <input type="hidden" name="transferId" value={verifyingTransfer.id} />
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Quantity Actually Received</label>
                <input name="quantityReceived" type="number" min={0} max={verifyingTransfer.quantitySent} required defaultValue={verifyingTransfer.quantitySent} className="input" />
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  If less than {verifyingTransfer.quantitySent}, a shrinkage alert will be sent to the CEO and Head of Logistics
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Shrinkage Reason <span className="text-surface-700 font-normal">(if qty differs)</span></label>
                <select name="shrinkageReason" className="input">
                  <option value="">N/A — full quantity received</option>
                  <option value="DAMAGED">Damaged in transit</option>
                  <option value="LOST">Lost during shipping</option>
                  <option value="EXPIRED">Expired product</option>
                  <option value="THEFT">Suspected theft</option>
                  <option value="COUNTING_ERROR">Counting error at source</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Verifying...">Confirm Delivery</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setVerifyingTransfer(null)}>Cancel</Button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        {([['all', 'All'], ['IN_TRANSIT', `In Transit (${inTransitCount})`], ['RECEIVED', 'Received'], ['DISPUTED', 'Disputed']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === val
                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-800 dark:text-surface-200 hover:border-surface-300 dark:hover:border-surface-600'
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
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{productName(t.productId)}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">{locationName(t.fromLocationId)}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">{locationName(t.toLocationId)}</td>
                    <td className="table-cell text-right font-medium">{t.quantitySent}</td>
                    <td className="table-cell text-right font-medium">
                      {t.quantityReceived !== null ? (
                        <span className={shrinkage > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}>
                          {t.quantityReceived}{shrinkage > 0 && <span className="text-xs ml-1">(-{shrinkage})</span>}
                        </span>
                      ) : <span className="text-surface-700 dark:text-surface-300">{'\u2014'}</span>}
                    </td>
                    <td className="table-cell">
                      <span className={TRANSFER_STATUS_BADGE[t.transferStatus] ?? 'badge'}>{t.transferStatus.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
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
                <tr><td colSpan={8} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No transfers found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filtered.map((t) => {
            const shrinkage = t.quantityReceived !== null ? t.quantitySent - t.quantityReceived : 0;
            return (
              <div key={t.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-surface-900 dark:text-white text-sm">{productName(t.productId)}</span>
                  <span className={TRANSFER_STATUS_BADGE[t.transferStatus] ?? 'badge'}>{t.transferStatus.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-surface-800 dark:text-surface-200">
                  <span>{locationName(t.fromLocationId)}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  <span>{locationName(t.toLocationId)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex gap-4">
                    <span>Sent: <span className="font-medium text-surface-900 dark:text-white">{t.quantitySent}</span></span>
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
          {filtered.length === 0 && <div className="p-8 text-center text-surface-700 dark:text-surface-300">No transfers found</div>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setWriteOffOrderId(null)} />
          <div className="relative bg-white dark:bg-surface-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Write Off — Damaged Item</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200">This will permanently mark the item as damaged and log it as an Operational Loss.</p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="writeOff" />
              <input type="hidden" name="orderId" value={writeOffOrderId} />
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Damage Note <span className="text-danger-500">*</span></label>
                <textarea name="reason" required minLength={10} rows={3} placeholder="Describe the damage (min 10 characters)..." className="input" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Writing off...">Write Off</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setWriteOffOrderId(null)}>Cancel</Button>
              </div>
            </fetcher.Form>
          </div>
        </div>
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
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{order.customerName}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-200">{locationName(order.logisticsLocationId)}</td>
                  <td className="table-cell text-sm text-surface-800 dark:text-surface-200 max-w-[200px] truncate">{order.deliveryNotes ?? '\u2014'}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
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
                <tr><td colSpan={6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No returned items pending assessment</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {returnedOrders.map((order) => (
            <div key={order.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-surface-900 dark:text-white text-sm">{order.customerName}</span>
                <span className="badge-warning">RETURNED</span>
              </div>
              <p className="text-xs text-surface-700 dark:text-surface-300">
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
          {returnedOrders.length === 0 && <div className="p-8 text-center text-surface-700 dark:text-surface-300">No returned items pending assessment</div>}
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
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Stock Reconciliation Report</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createReconciliation" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Location</label>
              <select name="locationId" required className="input">
                <option value="">Select location...</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name} {l.dispatchLocked ? '(LOCKED)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
              <select name="productId" required className="input">
                <option value="">Select product...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Physical Count (actual units on shelf)</label>
              <input name="physicalCount" type="number" min={0} required placeholder="Actual count" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Reason Code</label>
              <select name="reasonCode" required className="input">
                <option value="DAMAGED">Damaged</option>
                <option value="LOST">Lost</option>
                <option value="EXPIRED">Expired</option>
                <option value="THEFT">Suspected Theft</option>
                <option value="COUNTING_ERROR">Counting Error</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Notes <span className="text-surface-700 font-normal">(min 10 characters)</span></label>
            <textarea name="notes" rows={2} minLength={10} placeholder="Describe the discrepancy..." className="input" />
          </div>
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
                      <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{locationName(r.locationId)}</td>
                      <td className="table-cell text-surface-800 dark:text-surface-200">{productName(r.productId)}</td>
                      <td className="table-cell text-right font-medium">{r.digitalCount}</td>
                      <td className="table-cell text-right font-medium">{r.physicalCount}</td>
                      <td className="table-cell text-right font-bold">
                        <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400' : r.discrepancy > 0 ? 'text-success-600 dark:text-success-400' : ''}>
                          {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
                        </span>
                      </td>
                      <td className="table-cell text-sm">{REASON_LABELS[r.reasonCode] ?? r.reasonCode}</td>
                      <td className="table-cell"><span className={RECON_STATUS_BADGE[r.reconciliationStatus] ?? 'badge'}>{r.reconciliationStatus}</span></td>
                      <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                        {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                  {(resolved as Reconciliation[]).length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No reconciliation records. Submit a report when physical stock differs from system records.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
              {(resolved as Reconciliation[]).map((r) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white text-sm">{locationName(r.locationId)}</span>
                    <span className={RECON_STATUS_BADGE[r.reconciliationStatus] ?? 'badge'}>{r.reconciliationStatus}</span>
                  </div>
                  <p className="text-xs text-surface-800 dark:text-surface-200">{productName(r.productId)} · {REASON_LABELS[r.reasonCode] ?? r.reasonCode}</p>
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
                <div className="p-8 text-center text-surface-700 dark:text-surface-300">No reconciliation records</div>
              )}
            </div>
          </div>
        )}
      </DeferredSection>
    </>
  );
}
