import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import type {
  ReturnsStreamData,
  ReturnedOrder,
  Location,
  Reconciliation,
  Product,
  InventoryLevel,
} from './types';

// ─── Constants ──────────────────────────────────────────

const RECON_STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
};

const REASON_LABELS: Record<string, string> = {
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  EXPIRED: 'Expired',
  THEFT: 'Suspected Theft',
  COUNTING_ERROR: 'Counting Error',
  OTHER: 'Other',
};

// ─── Component ──────────────────────────────────────────

export function ReturnsPage({
  returnedOrders,
  locations,
  reconciliations,
  products,
  levels: _levels,
}: ReturnsStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'returns' | 'reconciliation'>('returns');
  const [writeOffOrderId, setWriteOffOrderId] = useState<string | null>(null);
  const [showReconciliationForm, setShowReconciliationForm] = useState(false);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Return processed' });

  if (actionSuccess && writeOffOrderId) setWriteOffOrderId(null);
  if (actionSuccess && showReconciliationForm) setShowReconciliationForm(false);

  const getLocationName = (id: string | null) => {
    if (!id) return '\u2014';
    return locations.find((l: Location) => l.id === id)?.name ?? id.slice(0, 8) + '...';
  };

  const lockedLocations = locations.filter((l: Location) => l.dispatchLocked);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Returns & Restock</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Process returned items and manage stock reconciliation
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setShowReconciliationForm(!showReconciliationForm); setActiveTab('reconciliation'); }}>
          {showReconciliationForm ? 'Close' : '+ Stock Reconciliation'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* Dispatch Lock Alerts */}
      {lockedLocations.length > 0 && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-sm font-semibold text-danger-700 dark:text-danger-400">Dispatch Locked</span>
          </div>
          <p className="text-sm text-danger-600 dark:text-danger-500">
            Dispatch is locked at: {lockedLocations.map((l: Location) => l.name).join(', ')}.
            Resolve pending reconciliations to unlock.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Returns Queue</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{returnedOrders.length}</p>
        </div>
        <DeferredSection resolve={reconciliations} skeleton="stat">
          {(resolvedReconciliations) => (
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Pending Recon.</p>
              <p className="text-2xl font-bold text-danger-600 dark:text-danger-400 mt-1">
                {resolvedReconciliations.filter((r: Reconciliation) => r.reconciliationStatus === 'PENDING').length}
              </p>
            </div>
          )}
        </DeferredSection>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Locked Locations</p>
          <p className="text-2xl font-bold text-danger-600 dark:text-danger-400 mt-1">{lockedLocations.length}</p>
        </div>
        <DeferredSection resolve={reconciliations} skeleton="stat">
          {(resolvedReconciliations) => (
            <div className="card">
              <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Recon.</p>
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{resolvedReconciliations.length}</p>
            </div>
          )}
        </DeferredSection>
      </div>

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'returns', label: `Returns Queue (${returnedOrders.length})` },
          { value: 'reconciliation', label: 'Reconciliation' },
        ]}
      />

      {activeTab === 'returns' ? (
        <>
          {/* Write-off modal */}
          {writeOffOrderId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/50" onClick={() => setWriteOffOrderId(null)} />
              <div className="relative bg-white dark:bg-surface-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Write Off — Damaged Item</h3>
                <p className="text-sm text-surface-800 dark:text-surface-200">
                  This will permanently mark the item as damaged and log it as an Operational Loss.
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="writeOff" />
                  <input type="hidden" name="orderId" value={writeOffOrderId} />
                  <div>
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                      Damage Note <span className="text-danger-500">*</span>
                    </label>
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      rows={3}
                      placeholder="Describe the damage (min 10 characters)..."
                      className="input"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Writing off...">
                      Write Off
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setWriteOffOrderId(null)}>
                      Cancel
                    </Button>
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
                  {returnedOrders.map((order: ReturnedOrder) => (
                    <tr key={order.id} className="table-row">
                      <td className="table-cell font-mono text-sm">{order.id.slice(0, 8)}...</td>
                      <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                        {order.customerName}
                      </td>
                      <td className="table-cell text-surface-800 dark:text-surface-200">
                        {getLocationName(order.logisticsLocationId)}
                      </td>
                      <td className="table-cell text-sm text-surface-800 dark:text-surface-200 max-w-[200px] truncate">
                        {order.deliveryNotes ?? '\u2014'}
                      </td>
                      <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                        {new Date(order.updatedAt).toLocaleDateString('en-NG', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-1.5">
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
                          <Button
                            variant="danger"
                            size="sm"
                            className="text-xs"
                            onClick={() => setWriteOffOrderId(order.id)}
                            title="Mark as damaged — write off as operational loss"
                          >
                            Damaged
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {returnedOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                        No returned items pending assessment
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
              {returnedOrders.map((order: ReturnedOrder) => (
                <div key={order.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-white text-sm">
                      {order.customerName}
                    </span>
                    <span className="badge-warning">RETURNED</span>
                  </div>
                  <p className="text-xs text-surface-700 dark:text-surface-300">
                    {getLocationName(order.logisticsLocationId)} · {new Date(order.updatedAt).toLocaleDateString('en-NG', {
                      month: 'short', day: 'numeric',
                    })}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <fetcher.Form method="post" className="inline">
                      <input type="hidden" name="intent" value="restock" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                        Sellable
                      </Button>
                    </fetcher.Form>
                    <Button variant="danger" size="sm" className="text-xs" onClick={() => setWriteOffOrderId(order.id)}>
                      Damaged
                    </Button>
                  </div>
                </div>
              ))}
              {returnedOrders.length === 0 && (
                <div className="p-8 text-center text-surface-700 dark:text-surface-300">
                  No returned items pending assessment
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Reconciliation Form — product/location dropdowns wrapped in DeferredSection */}
          {showReconciliationForm && (
            <DeferredSection resolve={products} skeleton="card">
              {(resolvedProducts) => (
                <fetcher.Form method="post" className="card space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Stock Reconciliation Report</h3>
                    <button type="button" onClick={() => setShowReconciliationForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <input type="hidden" name="intent" value="createReconciliation" />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Location</label>
                      <select name="locationId" required className="input">
                        <option value="">Select location...</option>
                        {locations.filter((l: Location) => l.status === 'ACTIVE').map((l: Location) => (
                          <option key={l.id} value={l.id}>
                            {l.name} {l.dispatchLocked ? '(LOCKED)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
                      <select name="productId" required className="input">
                        <option value="">Select product...</option>
                        {resolvedProducts.filter((p: Product) => p.status === 'ACTIVE').map((p: Product) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                        Physical Count (actual units on shelf)
                      </label>
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
                    <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                      Notes <span className="text-surface-700 font-normal">(min 10 characters)</span>
                    </label>
                    <textarea name="notes" rows={2} minLength={10} placeholder="Describe the discrepancy..." className="input" />
                  </div>

                  <div className="bg-warning-50 dark:bg-warning-700/10 border border-warning-200 dark:border-warning-700/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-warning-700 dark:text-warning-400">
                      If the physical count differs from the digital record, dispatch will be LOCKED at this location
                      until the reconciliation is approved.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Submitting...">
                      Submit Reconciliation
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowReconciliationForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </fetcher.Form>
              )}
            </DeferredSection>
          )}

          {/* Reconciliations table */}
          <DeferredSection resolve={reconciliations} skeleton="table">
            {(resolvedReconciliations) => (
              <ReconciliationTable
                reconciliations={resolvedReconciliations}
                locations={locations}
                products={products}
                fetcher={fetcher}
              />
            )}
          </DeferredSection>
        </>
      )}
    </div>
  );
}

// ─── Reconciliation Table Sub-component ─────────────────

function ReconciliationTable({
  reconciliations,
  locations,
  products,
  fetcher,
}: {
  reconciliations: Reconciliation[];
  locations: Location[];
  products: Promise<Product[]> | Product[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const getLocationName = (id: string) => {
    return locations.find((l: Location) => l.id === id)?.name ?? id.slice(0, 8) + '...';
  };

  return (
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
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reconciliations.map((r: Reconciliation) => (
              <tr key={r.id} className="table-row">
                <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                  {getLocationName(r.locationId)}
                </td>
                <td className="table-cell text-surface-800 dark:text-surface-200">
                  <DeferredSection resolve={products} skeleton="inline">
                    {(resolvedProducts) => {
                      const prod = (resolvedProducts as Product[]).find((p: Product) => p.id === r.productId);
                      return <>{prod?.name ?? r.productId.slice(0, 8) + '...'}</>;
                    }}
                  </DeferredSection>
                </td>
                <td className="table-cell text-right font-medium">{r.digitalCount}</td>
                <td className="table-cell text-right font-medium">{r.physicalCount}</td>
                <td className="table-cell text-right font-bold">
                  <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400' : r.discrepancy > 0 ? 'text-success-600 dark:text-success-400' : ''}>
                    {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
                  </span>
                </td>
                <td className="table-cell text-sm">
                  {REASON_LABELS[r.reasonCode] ?? r.reasonCode}
                </td>
                <td className="table-cell">
                  <span className={RECON_STATUS_BADGE[r.reconciliationStatus] ?? 'badge'}>
                    {r.reconciliationStatus}
                  </span>
                </td>
                <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                  {new Date(r.createdAt).toLocaleDateString('en-NG', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="table-cell">
                  {r.reconciliationStatus === 'PENDING' && (
                    <div className="flex gap-1.5">
                      <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="resolveReconciliation" />
                        <input type="hidden" name="reconciliationId" value={r.id} />
                        <input type="hidden" name="approved" value="true" />
                        <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                          Approve
                        </Button>
                      </fetcher.Form>
                      <fetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="resolveReconciliation" />
                        <input type="hidden" name="reconciliationId" value={r.id} />
                        <input type="hidden" name="approved" value="false" />
                        <Button type="submit" variant="danger" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                          Reject
                        </Button>
                      </fetcher.Form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {reconciliations.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                  No reconciliation records. Submit a report when physical stock differs from system records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
        {reconciliations.map((r: Reconciliation) => (
          <div key={r.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-surface-900 dark:text-white text-sm">
                {getLocationName(r.locationId)}
              </span>
              <span className={RECON_STATUS_BADGE[r.reconciliationStatus] ?? 'badge'}>
                {r.reconciliationStatus}
              </span>
            </div>
            <p className="text-xs text-surface-800 dark:text-surface-200">
              <DeferredSection resolve={products} skeleton="inline">
                {(resolvedProducts) => {
                  const prod = (resolvedProducts as Product[]).find((p: Product) => p.id === r.productId);
                  return <>{prod?.name ?? r.productId.slice(0, 8) + '...'}</>;
                }}
              </DeferredSection>
              {' '} · {REASON_LABELS[r.reasonCode] ?? r.reasonCode}
            </p>
            <div className="flex gap-4 text-sm">
              <span>Digital: <strong>{r.digitalCount}</strong></span>
              <span>Physical: <strong>{r.physicalCount}</strong></span>
              <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400 font-bold' : 'text-success-600 dark:text-success-400 font-bold'}>
                {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
              </span>
            </div>
            {r.reconciliationStatus === 'PENDING' && (
              <div className="flex gap-2 pt-1">
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="resolveReconciliation" />
                  <input type="hidden" name="reconciliationId" value={r.id} />
                  <input type="hidden" name="approved" value="true" />
                  <Button type="submit" variant="success" size="sm" className="text-xs">Approve</Button>
                </fetcher.Form>
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="resolveReconciliation" />
                  <input type="hidden" name="reconciliationId" value={r.id} />
                  <input type="hidden" name="approved" value="false" />
                  <Button type="submit" variant="danger" size="sm" className="text-xs">Reject</Button>
                </fetcher.Form>
              </div>
            )}
          </div>
        ))}
        {reconciliations.length === 0 && (
          <div className="p-8 text-center text-surface-700 dark:text-surface-300">
            No reconciliation records
          </div>
        )}
      </div>
    </div>
  );
}
