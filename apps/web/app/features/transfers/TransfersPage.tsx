import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';

export function TransfersPage({ transfers, locations, products, levels, canInitiate = true }: TransfersStreamData) {
  const fetcher = useFetcher();
  const [showForm, setShowForm] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedFromLocation, setSelectedFromLocation] = useState('');

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Transfer recorded' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (actionSuccess && showForm) setShowForm(false);
  }, [actionSuccess, showForm]);

  const getLocationName = (id: string) => {
    const loc = locations.find((l: Location) => l.id === id);
    return loc?.name ?? id.slice(0, 8) + '...';
  };

  const activeLocations = locations.filter((l: Location) => l.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Transfers"
        description="Record stock movements between your warehouse and other locations. Inventory updates as soon as you save."
        actions={
          canInitiate ? (
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Close' : '+ Record transfer'}
            </Button>
          ) : undefined
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
          { label: 'Transfer records', value: transfers.length, valueClassName: 'text-app-fg' },
        ]}
      />

      {canInitiate && (
        <ResponsiveFormPanel open={showForm} onClose={() => setShowForm(false)}>
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
                        <h3 className="text-lg font-semibold text-app-fg">Record stock transfer</h3>
                        <button type="button" onClick={() => setShowForm(false)} className="text-app-fg-muted hover:text-app-fg">
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
                          label="From location"
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
                          label="To location"
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

                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                          Save transfer
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>
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

      <div className="card p-0 overflow-hidden">
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
              {transfers.map((t: Transfer) => {
                const legacy = t.transferStatus && t.transferStatus !== 'RECEIVED';
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
                    <td className="table-cell text-app-fg-muted">{getLocationName(t.fromLocationId)}</td>
                    <td className="table-cell text-app-fg-muted">{getLocationName(t.toLocationId)}</td>
                    <td className="table-cell text-right font-medium">
                      {t.transferStatus === 'DISPUTED' && t.quantityReceived !== null
                        ? `${t.quantityReceived} / ${t.quantitySent}`
                        : t.quantityReceived ?? t.quantitySent}
                    </td>
                    <td className="table-cell text-app-fg-muted text-sm">
                      {t.verifiedAt
                        ? new Date(t.verifiedAt).toLocaleDateString('en-NG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : new Date(t.createdAt).toLocaleDateString('en-NG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                    </td>
                    <td className="table-cell text-xs text-app-fg-muted max-w-[8rem]">
                      {legacy && t.transferStatus === 'IN_TRANSIT' && 'Awaiting completion (legacy)'}
                      {legacy && t.transferStatus === 'DISPUTED' && t.shrinkageReason
                        ? `Discrepancy: ${t.shrinkageReason}`
                        : null}
                    </td>
                  </tr>
                );
              })}
              {transfers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <EmptyState
                      title="No transfers yet"
                      description="Record a transfer to move stock between locations and keep the ledger in sync."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 px-1">
          {transfers.map((t: Transfer) => {
            const legacy = t.transferStatus && t.transferStatus !== 'RECEIVED';
            return (
              <div key={t.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="font-medium text-app-fg text-sm">
                  <DeferredSection resolve={products} skeleton="inline">
                    {(resolvedProducts) => {
                      const prod = resolvedProducts.find((p: Product) => p.id === t.productId);
                      return <>{prod?.name ?? t.productId.slice(0, 8) + '...'}</>;
                    }}
                  </DeferredSection>
                </div>
                <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                  <span>{getLocationName(t.fromLocationId)}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  <span>{getLocationName(t.toLocationId)}</span>
                </div>
                <div className="text-sm text-app-fg">
                  <span className="text-app-fg-muted">Qty: </span>
                  <span className="font-medium">
                    {t.transferStatus === 'DISPUTED' && t.quantityReceived !== null
                      ? `${t.quantityReceived} / ${t.quantitySent}`
                      : t.quantityReceived ?? t.quantitySent}
                  </span>
                </div>
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
          {transfers.length === 0 && (
            <EmptyState
              title="No transfers yet"
              description="Record a transfer to move stock between locations and keep the ledger in sync."
            />
          )}
        </div>
      </div>
    </div>
  );
}
