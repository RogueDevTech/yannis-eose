import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Tabs } from '~/components/ui/tabs';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';
import { STATUS_BADGE } from './types';

export function TransfersPage({ transfers, locations, products, levels, canInitiate = true }: TransfersStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'all' | 'in_transit' | 'received' | 'disputed'>('all');
  const [showInitiateForm, setShowInitiateForm] = useState(false);
  const [verifyingTransfer, setVerifyingTransfer] = useState<Transfer | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedFromLocation, setSelectedFromLocation] = useState('');

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Transfer updated' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showInitiateForm) setShowInitiateForm(false);
  if (actionSuccess && verifyingTransfer) setVerifyingTransfer(null);

  // Helper lookups — locations are always available
  const getLocationName = (id: string) => {
    const loc = locations.find((l: Location) => l.id === id);
    return loc?.name ?? id.slice(0, 8) + '...';
  };

  // Filter transfers
  const filteredTransfers = activeTab === 'all'
    ? transfers
    : transfers.filter((t: Transfer) => t.transferStatus === activeTab.toUpperCase());

  // Stats
  const inTransitCount = transfers.filter((t: Transfer) => t.transferStatus === 'IN_TRANSIT').length;
  const receivedCount = transfers.filter((t: Transfer) => t.transferStatus === 'RECEIVED').length;
  const disputedCount = transfers.filter((t: Transfer) => t.transferStatus === 'DISPUTED').length;
  const totalShrinkage = transfers
    .filter((t: Transfer) => t.transferStatus === 'DISPUTED' && t.quantityReceived !== null)
    .reduce((sum: number, t: Transfer) => sum + (t.quantitySent - (t.quantityReceived ?? 0)), 0);

  // Active locations for selectors
  const activeLocations = locations.filter((l: Location) => l.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Stock Transfers</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Dual-entry stock transfers between warehouse and 3PL locations
          </p>
        </div>
        {canInitiate && (
          <Button variant="primary" size="sm" onClick={() => setShowInitiateForm(!showInitiateForm)}>
            {showInitiateForm ? 'Close' : '+ Initiate Transfer'}
          </Button>
        )}
      </div>

      {/* Error banner */}
      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Transfers</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{transfers.length}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">In Transit</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{inTransitCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Received</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{receivedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            Disputed / Shrinkage
          </p>
          <p className="text-2xl font-bold text-danger-600 dark:text-danger-400 mt-1">
            {disputedCount}{totalShrinkage > 0 && <span className="text-sm font-normal ml-1">({totalShrinkage} units)</span>}
          </p>
        </div>
      </div>

      {/* Initiate Transfer Form — only when canInitiate (admin); TPL only verifies receipt */}
      {canInitiate && (
      <ResponsiveFormPanel open={showInitiateForm} onClose={() => setShowInitiateForm(false)}>
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
                  <fetcher.Form method="post" className="card space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Initiate Stock Transfer</h3>
                      <button type="button" onClick={() => setShowInitiateForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <input type="hidden" name="intent" value="initiateTransfer" />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
                        <select
                          name="productId"
                          required
                          className="input"
                          value={selectedProductId}
                          onChange={(e) => setSelectedProductId(e.target.value)}
                        >
                          <option value="">Select product...</option>
                          {activeProducts.map((p: Product) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">From Location</label>
                        <select
                          name="fromLocationId"
                          required
                          className="input"
                          value={selectedFromLocation}
                          onChange={(e) => setSelectedFromLocation(e.target.value)}
                        >
                          <option value="">Select source...</option>
                          {activeLocations.map((l: Location) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                              {selectedProductId && ` (${getAvailableStock(selectedProductId, l.id)} avail.)`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">To Location</label>
                        <select name="toLocationId" required className="input">
                          <option value="">Select destination...</option>
                          {activeLocations
                            .filter((l: Location) => l.id !== selectedFromLocation)
                            .map((l: Location) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                          Quantity
                          {selectedProductId && selectedFromLocation && (
                            <span className="text-surface-700 dark:text-surface-300 font-normal ml-1">
                              (max: {getAvailableStock(selectedProductId, selectedFromLocation)})
                            </span>
                          )}
                        </label>
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={selectedProductId && selectedFromLocation ? getAvailableStock(selectedProductId, selectedFromLocation) : undefined}
                          required
                          placeholder="Units to transfer"
                          className="input"
                        />
                      </div>
                    </div>

                    {/* Visual transfer flow */}
                    {selectedProductId && selectedFromLocation && (
                      <div className="flex items-center justify-center gap-3 py-2 text-sm text-surface-800 dark:text-surface-200">
                        <span className="font-medium text-surface-700 dark:text-surface-200">
                          {getLocationName(selectedFromLocation)}
                        </span>
                        <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <span className="text-surface-700 dark:text-surface-300">3PL Location</span>
                      </div>
                    )}

                    <div className="bg-warning-50 dark:bg-warning-700/10 border border-warning-200 dark:border-warning-700/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-warning-700 dark:text-warning-400">
                        Stock will be deducted from the source immediately and marked as IN TRANSIT.
                        The 3PL manager must verify receipt before stock appears at the destination.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Initiating...">
                        Initiate Transfer
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setShowInitiateForm(false)}>
                        Cancel
                      </Button>
                    </div>
                  </fetcher.Form>
                );
              }}
            </DeferredSection>
          )}
        </DeferredSection>
      </ResponsiveFormPanel>
      )}

      {/* Verify Transfer Modal */}
      {verifyingTransfer && (
        <Modal open onClose={() => setVerifyingTransfer(null)} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 bg-white dark:bg-surface-800">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Verify Transfer Receipt</h3>
              <button onClick={() => setVerifyingTransfer(null)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Transfer details — product name deferred */}
            <div className="bg-surface-50 dark:bg-surface-700/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">Product</span>
                <span className="font-medium text-surface-900 dark:text-white">
                  <DeferredSection resolve={products} skeleton="inline">
                    {(resolvedProducts) => {
                      const prod = resolvedProducts.find((p: Product) => p.id === verifyingTransfer.productId);
                      return <>{prod?.name ?? verifyingTransfer.productId.slice(0, 8) + '...'}</>;
                    }}
                  </DeferredSection>
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">From</span>
                <span className="font-medium text-surface-900 dark:text-white">
                  {getLocationName(verifyingTransfer.fromLocationId)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-200">To</span>
                <span className="font-medium text-surface-900 dark:text-white">
                  {getLocationName(verifyingTransfer.toLocationId)}
                </span>
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
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Quantity Actually Received
                </label>
                <input
                  name="quantityReceived"
                  type="number"
                  min={0}
                  max={verifyingTransfer.quantitySent}
                  required
                  defaultValue={verifyingTransfer.quantitySent}
                  className="input"
                />
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  If less than {verifyingTransfer.quantitySent}, a shrinkage alert will be sent to the CEO and Head of Logistics
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                  Shrinkage Reason <span className="text-surface-700 font-normal">(if qty differs)</span>
                </label>
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
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Verifying...">
                  Confirm Receipt
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setVerifyingTransfer(null)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'all', label: `All (${transfers.length})` },
          { value: 'in_transit', label: `In Transit (${inTransitCount})` },
          { value: 'received', label: `Received (${receivedCount})` },
          { value: 'disputed', label: `Disputed (${disputedCount})` },
        ]}
      />

      {/* Transfers Table — Desktop */}
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
              {filteredTransfers.map((t: Transfer) => {
                const shrinkage = t.quantityReceived !== null ? t.quantitySent - t.quantityReceived : 0;
                return (
                  <tr key={t.id} className="table-row">
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                      <DeferredSection resolve={products} skeleton="inline">
                        {(resolvedProducts) => {
                          const prod = resolvedProducts.find((p: Product) => p.id === t.productId);
                          return <>{prod?.name ?? t.productId.slice(0, 8) + '...'}</>;
                        }}
                      </DeferredSection>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">
                      {getLocationName(t.fromLocationId)}
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">
                      {getLocationName(t.toLocationId)}
                    </td>
                    <td className="table-cell text-right font-medium">{t.quantitySent}</td>
                    <td className="table-cell text-right font-medium">
                      {t.quantityReceived !== null ? (
                        <span className={shrinkage > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}>
                          {t.quantityReceived}
                          {shrinkage > 0 && (
                            <span className="text-xs ml-1">(-{shrinkage})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-surface-700 dark:text-surface-300">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={STATUS_BADGE[t.transferStatus] ?? 'badge'}>
                        {t.transferStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
                      {new Date(t.createdAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="table-cell">
                      {t.transferStatus === 'IN_TRANSIT' && (
                        <Button variant="primary" size="sm" className="text-xs" onClick={() => setVerifyingTransfer(t)}>
                          Verify Receipt
                        </Button>
                      )}
                      {t.transferStatus === 'DISPUTED' && t.shrinkageReason && (
                        <span className="text-xs text-danger-600 dark:text-danger-400" title={t.shrinkageReason}>
                          {t.shrinkageReason}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredTransfers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                    {activeTab === 'all'
                      ? 'No transfers yet. Initiate a transfer to move stock between locations.'
                      : `No ${activeTab.replace('_', ' ')} transfers.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3 px-1">
          {filteredTransfers.map((t: Transfer) => {
            const shrinkage = t.quantityReceived !== null ? t.quantitySent - t.quantityReceived : 0;
            return (
              <div key={t.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-surface-900 dark:text-white text-sm">
                    <DeferredSection resolve={products} skeleton="inline">
                      {(resolvedProducts) => {
                        const prod = resolvedProducts.find((p: Product) => p.id === t.productId);
                        return <>{prod?.name ?? t.productId.slice(0, 8) + '...'}</>;
                      }}
                    </DeferredSection>
                  </span>
                  <span className={STATUS_BADGE[t.transferStatus] ?? 'badge'}>
                    {t.transferStatus.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-surface-800 dark:text-surface-200">
                  <span>{getLocationName(t.fromLocationId)}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  <span>{getLocationName(t.toLocationId)}</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex gap-4">
                    <span>
                      Sent: <span className="font-medium text-surface-900 dark:text-white">{t.quantitySent}</span>
                    </span>
                    {t.quantityReceived !== null && (
                      <span>
                        Recv:{' '}
                        <span className={`font-medium ${shrinkage > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                          {t.quantityReceived}
                        </span>
                      </span>
                    )}
                  </div>
                  {t.transferStatus === 'IN_TRANSIT' && (
                    <Button variant="primary" size="sm" className="text-xs" onClick={() => setVerifyingTransfer(t)}>
                      Verify
                    </Button>
                  )}
                </div>

                <p className="text-xs text-surface-700 dark:text-surface-300">
                  {new Date(t.createdAt).toLocaleDateString('en-NG', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                  {t.verifiedAt && (
                    <> · Verified: {new Date(t.verifiedAt).toLocaleDateString('en-NG', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}</>
                  )}
                </p>
              </div>
            );
          })}
          {filteredTransfers.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-300">
              No transfers found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
