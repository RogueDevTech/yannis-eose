import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { DataTable, type TableColumn } from '~/components/ui/data-table';
import { DescriptionList } from '~/components/ui/description-list';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';

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
  const [showForm, setShowForm] = useState(false);
  const [viewTransfer, setViewTransfer] = useState<Transfer | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedFromLocation, setSelectedFromLocation] = useState('');
  const [selectedToLocationId, setSelectedToLocationId] = useState('');

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

  useEffect(() => {
    if (actionSuccess) {
      setSelectedProductId('');
      setSelectedFromLocation('');
      setSelectedToLocationId('');
    }
  }, [actionSuccess]);

  useEffect(() => {
    setSelectedToLocationId((prev) => (prev === selectedFromLocation ? '' : prev));
  }, [selectedFromLocation]);

  const getLocationName = (id: string) => {
    const loc = locations.find((l: Location) => l.id === id);
    return loc?.name ?? id.slice(0, 8) + '...';
  };

  const activeLocations = locations.filter((l: Location) => l.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Transfers"
        description="Record stock movements between your warehouse and other locations. Receipt is confirmed in Logistics → Stock Transfer Confirmations."
        actions={
          canInitiate ? (
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
                              label: l.name,
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
                            options={activeLocations
                              .filter((l: Location) => l.id !== selectedFromLocation)
                              .map((l: Location) => ({
                                value: l.id,
                                label: l.name,
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

            const columns: TableColumn<Transfer>[] = [
              {
                key: 'product',
                header: 'Product',
                render: (t) => <span className="font-medium text-app-fg">{productName(t.productId)}</span>,
                minWidth: 'min-w-[140px]',
              },
              {
                key: 'from',
                header: 'From',
                render: (t) => <span className="text-app-fg-muted">{getLocationName(t.fromLocationId)}</span>,
                hideOnMobile: true,
              },
              {
                key: 'to',
                header: 'To',
                render: (t) => <span className="text-app-fg-muted">{getLocationName(t.toLocationId)}</span>,
                hideOnMobile: true,
              },
              {
                key: 'route',
                header: 'Route',
                className: 'sm:hidden',
                render: (t) => (
                  <span className="text-xs text-app-fg-muted">
                    {getLocationName(t.fromLocationId)} → {getLocationName(t.toLocationId)}
                  </span>
                ),
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
                key: 'actions',
                header: '',
                align: 'right',
                className: 'w-[1%] whitespace-nowrap',
                render: (t) => (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setViewTransfer(t)}>
                    View
                  </Button>
                ),
              },
            ];

            return (
              <DataTable
                caption="Stock transfers"
                columns={columns}
                data={transfers}
                keyField="id"
                emptyTitle="No transfers yet"
                emptyDescription="Record a transfer to move stock between locations and keep the ledger in sync."
                stickyHeader={false}
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
                    ]}
                  />
                );
              }}
            </DeferredSection>
            <p className="text-xs text-app-fg-muted">
              Confirm or dispute receipt in <span className="font-medium text-app-fg">Logistics → Stock Transfer Confirmations</span>.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewTransfer(null)}>
              Close
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
