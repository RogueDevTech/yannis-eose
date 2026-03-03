import { useState, useEffect, useRef } from 'react';
import { useFetcher } from '@remix-run/react';
import { exportToCsv } from '~/lib/csv-export';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { InlineNotification } from '~/components/ui/inline-notification';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import type { InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption } from './types';
import { MOVEMENT_COLORS, formatMovementType } from './types';

export function InventoryPage({ levels, totalLevels, movements, totalMovements, products, locations }: InventoryStreamData) {
  const [activeTab, setActiveTab] = useState<'levels' | 'movements'>('levels');

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
  const locationName = (id: string | null) => id ? (locations.find((l) => l.id === id)?.name ?? id.slice(0, 8) + '…') : '—';
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const fetcher = useFetcher();

  const intakeError = (fetcher.data as { error?: string } | undefined)?.error;
  const intakeSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const intakeErrorRef = useRef<HTMLDivElement>(null);
  useFetcherToast(fetcher.data, { successMessage: 'Stock added successfully' });

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
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowIntakeForm(!showIntakeForm)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Stock Intake
          </Button>
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

      {/* Stock Intake form */}
      {showIntakeForm && (
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
          {intakeError && (
            <div ref={intakeErrorRef} className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
              <p className="text-sm text-danger-700 dark:text-danger-500">{intakeError}</p>
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
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'levels', label: `Stock Levels (${totalLevels})` },
          { value: 'movements', label: 'Movement Log' },
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
    </div>
  );
}
