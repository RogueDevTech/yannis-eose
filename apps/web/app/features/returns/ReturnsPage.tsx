import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Tabs } from '~/components/ui/tabs';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Textarea } from '~/components/ui/textarea';
import { TextInput } from '~/components/ui/text-input';
import type {
  ReturnsStreamData,
  ReturnedOrder,
  Location,
  Reconciliation,
  Product,
  InventoryLevel,
} from './types';

// ─── Constants ──────────────────────────────────────────

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
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Return processed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

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
      <PageHeader
        title="Returns & Restock"
        description="Process returned items and manage stock reconciliation"
        actions={
          <Button variant="secondary" size="sm" onClick={() => { setShowReconciliationForm(!showReconciliationForm); setActiveTab('reconciliation'); }}>
            {showReconciliationForm ? 'Close' : '+ Stock Reconciliation'}
          </Button>
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

      <DeferredSection resolve={reconciliations} fallback={<OverviewStatStripSkeleton count={4} />}>
        {(resolvedReconciliations) => (
          <OverviewStatStrip
            items={[
              {
                label: 'Returns Queue',
                value: returnedOrders.length,
                valueClassName: 'text-warning-600 dark:text-warning-400',
              },
              {
                label: 'Pending Recon.',
                value: resolvedReconciliations.filter((r: Reconciliation) => r.reconciliationStatus === 'PENDING').length,
                valueClassName: 'text-danger-600 dark:text-danger-400',
              },
              {
                label: 'Locked Locations',
                value: lockedLocations.length,
                valueClassName: 'text-danger-600 dark:text-danger-400',
              },
              {
                label: 'Total Recon.',
                value: resolvedReconciliations.length,
                valueClassName: 'text-app-fg',
              },
            ]}
          />
        )}
      </DeferredSection>

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
            <Modal open onClose={() => setWriteOffOrderId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
                <h3 className="text-lg font-semibold text-app-fg">Write Off — Damaged Item</h3>
                <p className="text-sm text-app-fg-muted">
                  This will permanently mark the item as damaged and log it as an Operational Loss.
                </p>
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="writeOff" />
                  <input type="hidden" name="orderId" value={writeOffOrderId} />
                  <Textarea
                    name="reason"
                    label="Damage Note"
                    required
                    minLength={10}
                    rows={3}
                    placeholder="Describe the damage (min 10 characters)..."
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Writing off...">
                      Write Off
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setWriteOffOrderId(null)}>
                      Cancel
                    </Button>
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
                  {returnedOrders.map((order: ReturnedOrder) => (
                    <tr key={order.id} className="table-row">
                      <td className="table-cell"><OrderIdBadge id={order.id} textClassName="font-mono text-sm text-app-fg-muted" /></td>
                      <td className="table-cell font-medium text-app-fg">
                        {order.customerName}
                      </td>
                      <td className="table-cell text-app-fg-muted">
                        {getLocationName(order.logisticsLocationId)}
                      </td>
                      <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">
                        {order.deliveryNotes ?? '\u2014'}
                      </td>
                      <td className="table-cell text-app-fg-muted text-sm">
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
                      <td colSpan={6} className="px-4 py-12 text-center">
                        <EmptyState
                          title="No returned items"
                          description="No returned items pending assessment"
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3 px-1">
              {returnedOrders.map((order: ReturnedOrder) => (
                <div key={order.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-app-fg text-sm">
                      {order.customerName}
                    </span>
                    <StatusBadge status="RETURNED" />
                  </div>
                  <p className="text-sm text-app-fg-muted">
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
                <EmptyState
                  title="No returned items"
                  description="No returned items pending assessment"
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Reconciliation Form — product/location dropdowns wrapped in DeferredSection */}
          <ResponsiveFormPanel open={showReconciliationForm} onClose={() => setShowReconciliationForm(false)}>
            <DeferredSection resolve={products} skeleton="card">
              {(resolvedProducts) => (
                <fetcher.Form method="post" className="card space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h3>
                    <button type="button" onClick={() => setShowReconciliationForm(false)} className="text-app-fg-muted hover:text-app-fg">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <input type="hidden" name="intent" value="createReconciliation" />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormSelect
                      name="locationId"
                      label="Location"
                      required
                      options={[
                        { value: '', label: 'Select location...' },
                        ...locations.filter((l: Location) => l.status === 'ACTIVE').map((l: Location) => ({
                          value: l.id,
                          label: `${l.name}${l.dispatchLocked ? ' (LOCKED)' : ''}`,
                        })),
                      ]}
                    />

                    <FormSelect
                      name="productId"
                      label="Product"
                      required
                      options={[
                        { value: '', label: 'Select product...' },
                        ...resolvedProducts.filter((p: Product) => p.status === 'ACTIVE').map((p: Product) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                    />

                    <TextInput
                      name="physicalCount"
                      type="number"
                      label="Physical Count (actual units on shelf)"
                      min={0}
                      required
                      placeholder="Actual count"
                    />

                    <FormSelect
                      name="reasonCode"
                      label="Reason Code"
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
                    name="notes"
                    label="Notes (min 10 characters)"
                    rows={2}
                    minLength={10}
                    placeholder="Describe the discrepancy..."
                  />

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
          </ResponsiveFormPanel>

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
                <td className="table-cell font-medium text-app-fg">
                  {getLocationName(r.locationId)}
                </td>
                <td className="table-cell text-app-fg-muted">
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
                  <StatusBadge status={r.reconciliationStatus} />
                </td>
                <td className="table-cell text-app-fg-muted text-sm">
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
                <td colSpan={9} className="px-4 py-12 text-center">
                  <EmptyState
                    title="No reconciliation records"
                    description="Submit a report when physical stock differs from system records."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-3 px-1">
        {reconciliations.map((r: Reconciliation) => (
          <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-app-fg text-sm">
                {getLocationName(r.locationId)}
              </span>
              <StatusBadge status={r.reconciliationStatus} />
            </div>
            <p className="text-sm text-app-fg-muted">
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
          <EmptyState
            title="No reconciliation records"
            description="Submit a report when physical stock differs from system records."
          />
        )}
      </div>
    </div>
  );
}
