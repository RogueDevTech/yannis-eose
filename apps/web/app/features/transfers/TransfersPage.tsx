import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';

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
      <PageHeader
        title="Stock Transfers"
        description="Dual-entry stock transfers between warehouse and 3PL locations"
        actions={
          canInitiate ? (
            <Button variant="primary" size="sm" onClick={() => setShowInitiateForm(!showInitiateForm)}>
              {showInitiateForm ? 'Close' : '+ Initiate Transfer'}
            </Button>
          ) : undefined
        }
      />

      {/* Error banner */}
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
          { label: 'Total Transfers', value: transfers.length, valueClassName: 'text-app-fg' },
          { label: 'In Transit', value: inTransitCount, valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'Received', value: receivedCount, valueClassName: 'text-success-600 dark:text-success-400' },
          {
            label: 'Disputed / Shrinkage',
            value: (
              <>
                {disputedCount}
                {totalShrinkage > 0 && (
                  <span className="text-sm font-normal ml-1">({totalShrinkage} units)</span>
                )}
              </>
            ),
            valueClassName: 'text-danger-600 dark:text-danger-400',
            title: totalShrinkage > 0 ? `${totalShrinkage} units shrinkage` : undefined,
          },
        ]}
      />

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
                      <h3 className="text-lg font-semibold text-app-fg">Initiate Stock Transfer</h3>
                      <button type="button" onClick={() => setShowInitiateForm(false)} className="text-app-fg-muted hover:text-app-fg">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <input type="hidden" name="intent" value="initiateTransfer" />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormSelect
                        name="productId"
                        label="Product"
                        required
                        value={selectedProductId}
                        onChange={(e) => setSelectedProductId(e.target.value)}
                        options={[
                          { value: '', label: 'Select product...' },
                          ...activeProducts.map((p: Product) => ({
                            value: p.id,
                            label: p.name,
                          })),
                        ]}
                      />

                      <FormSelect
                        name="fromLocationId"
                        label="From Location"
                        required
                        value={selectedFromLocation}
                        onChange={(e) => setSelectedFromLocation(e.target.value)}
                        options={[
                          { value: '', label: 'Select source...' },
                          ...activeLocations.map((l: Location) => ({
                            value: l.id,
                            label: `${l.name}${selectedProductId ? ` (${getAvailableStock(selectedProductId, l.id)} avail.)` : ''}`,
                          })),
                        ]}
                      />

                      <FormSelect
                        name="toLocationId"
                        label="To Location"
                        required
                        options={[
                          { value: '', label: 'Select destination...' },
                          ...activeLocations
                            .filter((l: Location) => l.id !== selectedFromLocation)
                            .map((l: Location) => ({
                              value: l.id,
                              label: l.name,
                            })),
                        ]}
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
                        placeholder="Units to transfer"
                      />
                    </div>

                    {/* Visual transfer flow */}
                    {selectedProductId && selectedFromLocation && (
                      <div className="flex items-center justify-center gap-3 py-2 text-sm text-app-fg-muted">
                        <span className="font-medium text-app-fg-muted">
                          {getLocationName(selectedFromLocation)}
                        </span>
                        <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <span className="text-app-fg-muted">3PL Location</span>
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
        <Modal open onClose={() => setVerifyingTransfer(null)} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 bg-app-elevated">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-app-fg">Verify Transfer Receipt</h3>
              <button onClick={() => setVerifyingTransfer(null)} className="text-app-fg-muted hover:text-app-fg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Transfer details — product name deferred */}
            <div className="bg-app-hover rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">Product</span>
                <span className="font-medium text-app-fg">
                  <DeferredSection resolve={products} skeleton="inline">
                    {(resolvedProducts) => {
                      const prod = resolvedProducts.find((p: Product) => p.id === verifyingTransfer.productId);
                      return <>{prod?.name ?? verifyingTransfer.productId.slice(0, 8) + '...'}</>;
                    }}
                  </DeferredSection>
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">From</span>
                <span className="font-medium text-app-fg">
                  {getLocationName(verifyingTransfer.fromLocationId)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">To</span>
                <span className="font-medium text-app-fg">
                  {getLocationName(verifyingTransfer.toLocationId)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-fg-muted">Quantity Sent</span>
                <span className="font-bold text-app-fg">{verifyingTransfer.quantitySent} units</span>
              </div>
            </div>

            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="verifyTransfer" />
              <input type="hidden" name="transferId" value={verifyingTransfer.id} />

              <div>
                <TextInput
                  name="quantityReceived"
                  type="number"
                  label="Quantity Actually Received"
                  min={0}
                  max={verifyingTransfer.quantitySent}
                  required
                  defaultValue={String(verifyingTransfer.quantitySent)}
                />
                <p className="text-xs text-app-fg-muted mt-1">
                  If less than {verifyingTransfer.quantitySent}, a shrinkage alert will be sent to the CEO and Head of Logistics
                </p>
              </div>

              <FormSelect
                name="shrinkageReason"
                label="Shrinkage Reason (if qty differs)"
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
                    <td className="table-cell font-medium text-app-fg">
                      <DeferredSection resolve={products} skeleton="inline">
                        {(resolvedProducts) => {
                          const prod = resolvedProducts.find((p: Product) => p.id === t.productId);
                          return <>{prod?.name ?? t.productId.slice(0, 8) + '...'}</>;
                        }}
                      </DeferredSection>
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {getLocationName(t.fromLocationId)}
                    </td>
                    <td className="table-cell text-app-fg-muted">
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
                        <span className="text-app-fg-muted">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={t.transferStatus} />
                    </td>
                    <td className="table-cell text-app-fg-muted text-sm">
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
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <EmptyState
                      title="No transfers found"
                      description={
                        activeTab === 'all'
                          ? 'No transfers yet. Initiate a transfer to move stock between locations.'
                          : `No ${activeTab.replace('_', ' ')} transfers.`
                      }
                    />
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
              <div key={t.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-app-fg text-sm">
                    <DeferredSection resolve={products} skeleton="inline">
                      {(resolvedProducts) => {
                        const prod = resolvedProducts.find((p: Product) => p.id === t.productId);
                        return <>{prod?.name ?? t.productId.slice(0, 8) + '...'}</>;
                      }}
                    </DeferredSection>
                  </span>
                  <StatusBadge status={t.transferStatus} />
                </div>

                <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                  <span>{getLocationName(t.fromLocationId)}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  <span>{getLocationName(t.toLocationId)}</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex gap-4">
                    <span>
                      Sent: <span className="font-medium text-app-fg">{t.quantitySent}</span>
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

                <p className="text-xs text-app-fg-muted">
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
            <EmptyState
              title="No transfers found"
              description={
                activeTab === 'all'
                  ? 'No transfers yet. Initiate a transfer to move stock between locations.'
                  : `No ${activeTab.replace('_', ' ')} transfers.`
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
