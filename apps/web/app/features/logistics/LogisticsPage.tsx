import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcher, useRevalidator } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import type {
  Provider,
  Location,
  HealthDashboard,
  ShrinkageAlert,
  StuckOrder,
  TransferDelay,
} from './types';

interface LogisticsPageProps {
  providers: Provider[];
  totalProviders: number;
  locations: Location[];
  totalLocations: number;
  healthDashboard: Promise<HealthDashboard | null> | null;
  canViewEscalations: boolean;
}

function formatTimeAgo(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return `${days}d ${remainingHours}h`;
}

interface ProviderRow {
  name: string;
  contactInfo: string;
  coverageArea: string;
}

function AddProviderForm({
  fetcher,
  onCancel,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<ProviderRow[]>([{ name: '', contactInfo: '', coverageArea: '' }]);

  function addRow() {
    setRows((prev) => [...prev, { name: '', contactInfo: '', coverageArea: '' }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: keyof ProviderRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  const filledCount = rows.filter((r) => r.name.trim()).length;

  return (
    <fetcher.Form method="post" className="px-6 py-4 space-y-3">
      <div className="flex items-center justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          + Add another
        </Button>
      </div>
      <input type="hidden" name="intent" value={rows.length > 1 ? 'createProviders' : 'createProvider'} />
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <TextInput
              name={rows.length > 1 ? `provider_${idx}_name` : 'name'}
              type="text"
              label={idx === 0 ? 'Provider name' : undefined}
              value={row.name}
              onChange={(e) => updateRow(idx, 'name', e.target.value)}
              placeholder="Provider name"
              required={idx === 0}
            />
            <TextInput
              name={rows.length > 1 ? `provider_${idx}_contactInfo` : 'contactInfo'}
              type="text"
              label={idx === 0 ? 'Contact info' : undefined}
              value={row.contactInfo}
              onChange={(e) => updateRow(idx, 'contactInfo', e.target.value)}
              placeholder="Contact info"
            />
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <TextInput
                  name={rows.length > 1 ? `provider_${idx}_coverageArea` : 'coverageArea'}
                  type="text"
                  label={idx === 0 ? 'Coverage area' : undefined}
                  value={row.coverageArea}
                  onChange={(e) => updateRow(idx, 'coverageArea', e.target.value)}
                  placeholder="Coverage area"
                />
              </div>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeRow(idx)}
                  className="shrink-0"
                  title="Remove row"
                >
                  —
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
          Create {filledCount > 1 ? `${filledCount} Providers` : 'Provider'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

function SeverityBadge({ hours, warningThreshold = 24, criticalThreshold = 48 }: { hours: number; warningThreshold?: number; criticalThreshold?: number }) {
  if (hours >= criticalThreshold) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        Critical - {formatTimeAgo(hours)}
      </span>
    );
  }
  if (hours >= warningThreshold) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Warning - {formatTimeAgo(hours)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
      {formatTimeAgo(hours)}
    </span>
  );
}

function EscalationsPanel({ healthDashboard }: { healthDashboard: HealthDashboard }) {
  const { shrinkageAlerts, stuckOrders, transferDelays, totalEscalations } = healthDashboard;

  if (totalEscalations === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-3 py-8 justify-center">
          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <span className="text-green-600 dark:text-green-400 text-lg">&#10003;</span>
          </div>
          <div>
            <p className="text-sm font-medium text-app-fg">All clear</p>
            <p className="text-xs text-app-fg-muted">No active escalations found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <OverviewStatStrip
        showScrollControls={false}
        items={[
          {
            label: 'Shrinkage Alerts',
            value: shrinkageAlerts.length,
            valueClassName: shrinkageAlerts.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-app-fg',
          },
          {
            label: 'Stuck Orders (>24h)',
            value: stuckOrders.length,
            valueClassName: stuckOrders.length > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-app-fg',
          },
          {
            label: 'Transfer Delays (>48h)',
            value: transferDelays.length,
            valueClassName: transferDelays.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-app-fg',
          },
        ]}
      />

      {/* Shrinkage Alerts Table */}
      {shrinkageAlerts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-app-fg mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
            Shrinkage Alerts
          </h3>
          <div className="card p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Product</th>
                  <th className="table-header">Route</th>
                  <th className="table-header text-right">Sent</th>
                  <th className="table-header text-right">Received</th>
                  <th className="table-header text-right">Shortage</th>
                  <th className="table-header">Reason</th>
                </tr>
              </thead>
              <tbody>
                {shrinkageAlerts.map((alert) => (
                  <tr key={alert.transferId} className="table-row">
                    <td className="table-cell font-medium text-app-fg">{alert.productName}</td>
                    <td className="table-cell text-app-fg-muted">
                      {alert.fromLocationName} → {alert.toLocationName}
                    </td>
                    <td className="table-cell text-right text-app-fg-muted">{alert.quantitySent}</td>
                    <td className="table-cell text-right text-app-fg-muted">{alert.quantityReceived ?? 0}</td>
                    <td className="table-cell text-right">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        -{alert.shortage}
                      </span>
                    </td>
                    <td className="table-cell text-app-fg-muted text-xs">
                      {alert.shrinkageReason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stuck Orders Table */}
      {stuckOrders.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-app-fg mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block"></span>
            Stuck Orders
          </h3>
          <div className="card p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Rider</th>
                  <th className="table-header">Time Stuck</th>
                </tr>
              </thead>
              <tbody>
                {stuckOrders.map((order) => (
                  <tr key={order.orderId} className="table-row">
                    <td className="table-cell font-mono text-xs text-app-fg-muted">
                      {order.orderId.slice(0, 8)}...
                    </td>
                    <td className="table-cell">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="table-cell text-app-fg-muted">{order.customerName}</td>
                    <td className="table-cell text-app-fg-muted">{order.riderName ?? '—'}</td>
                    <td className="table-cell">
                      <SeverityBadge hours={order.stuckHours} warningThreshold={24} criticalThreshold={48} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer Delays Table */}
      {transferDelays.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-app-fg mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
            Transfer Delays
          </h3>
          <div className="card p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Transfer ID</th>
                  <th className="table-header">Product</th>
                  <th className="table-header">Route</th>
                  <th className="table-header text-right">Qty Sent</th>
                  <th className="table-header">Time in Transit</th>
                </tr>
              </thead>
              <tbody>
                {transferDelays.map((transfer) => (
                  <tr key={transfer.transferId} className="table-row">
                    <td className="table-cell font-mono text-xs text-app-fg-muted">
                      {transfer.transferId.slice(0, 8)}...
                    </td>
                    <td className="table-cell font-medium text-app-fg">{transfer.productName}</td>
                    <td className="table-cell text-app-fg-muted">
                      {transfer.fromLocationName} → {transfer.toLocationName}
                    </td>
                    <td className="table-cell text-right text-app-fg-muted">{transfer.quantitySent}</td>
                    <td className="table-cell">
                      <SeverityBadge hours={transfer.delayHours} warningThreshold={48} criticalThreshold={72} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function LogisticsPage({ providers, totalProviders, locations, totalLocations, healthDashboard, canViewEscalations }: LogisticsPageProps) {
  const fetcher = useFetcher();
  const { revalidate, state: revalidatorState } = useRevalidator();
  const [activeTab, setActiveTab] = useState<'providers' | 'locations' | 'escalations'>('providers');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [viewingProvider, setViewingProvider] = useState<Provider | null>(null);

  const actionError = (fetcher.data as { error?: string })?.error;
  const actionSuccess = (fetcher.data as { success?: boolean })?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Logistics action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Revalidate loader data when action succeeds so new providers/locations appear
  useEffect(() => {
    if (actionSuccess && revalidatorState === 'idle') {
      revalidate();
    }
  }, [actionSuccess, revalidatorState, revalidate]);

  // Close forms on success
  useEffect(() => {
    if (actionSuccess) {
      setShowAddProvider(false);
      setShowAddLocation(false);
      setEditingProvider(null);
    }
  }, [actionSuccess]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logistics"
        description="Manage 3PL providers, locations, and delivery operations"
        actions={
          <div className="flex gap-2">
            <PageRefreshButton />
            <Button variant="secondary" size="sm" onClick={() => setShowAddProvider(true)}>
              + Provider
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAddLocation(true)}>
              + Location
            </Button>
          </div>
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

      {canViewEscalations && healthDashboard ? (
        <DeferredSection resolve={healthDashboard} fallback={<OverviewStatStripSkeleton count={3} />}>
          {(resolvedHealth) => (
            <OverviewStatStrip
              items={[
                { label: 'Providers', value: totalProviders, valueClassName: 'text-app-fg' },
                { label: 'Locations', value: totalLocations, valueClassName: 'text-app-fg' },
                {
                  label: 'Escalations',
                  value: resolvedHealth ? resolvedHealth.totalEscalations : '—',
                  valueClassName:
                    resolvedHealth && resolvedHealth.totalEscalations > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-app-fg',
                },
              ]}
            />
          )}
        </DeferredSection>
      ) : (
        <OverviewStatStrip
          showScrollControls={false}
          items={[
            { label: 'Providers', value: totalProviders, valueClassName: 'text-app-fg' },
            { label: 'Locations', value: totalLocations, valueClassName: 'text-app-fg' },
          ]}
        />
      )}

      {/* Add Provider Modal */}
      {showAddProvider && (
        <Modal open onClose={() => setShowAddProvider(false)} maxWidth="max-w-2xl" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Add Provider</h3>
            <button
              type="button"
              onClick={() => setShowAddProvider(false)}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <AddProviderForm
            fetcher={fetcher}
            onCancel={() => setShowAddProvider(false)}
          />
        </Modal>
      )}

      {/* Add Location Modal */}
      {showAddLocation && (
        <Modal open onClose={() => setShowAddLocation(false)} maxWidth="max-w-2xl" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Add Location</h3>
            <button
              type="button"
              onClick={() => setShowAddLocation(false)}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <fetcher.Form method="post" className="px-6 py-4 space-y-3">
            <input type="hidden" name="intent" value="createLocation" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormSelect
                name="providerId"
                required
                options={providers.map((p: Provider) => ({ value: p.id, label: p.name }))}
                placeholder="Select provider..."
              />
              <TextInput name="name" type="text" required placeholder="Location name" />
              <TextInput name="address" type="text" required placeholder="Address" />
              <TextInput name="coordinates" type="text" placeholder="GPS coordinates (optional)" />
              <TextInput
                name="whatsappGroupLink"
                type="url"
                placeholder="https://chat.whatsapp.com/... (optional)"
                hint="WhatsApp group invite link used by the CS 'Share to 3PL' flow."
                wrapperClassName="sm:col-span-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddLocation(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
                Create Location
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Edit Provider Modal */}
      {editingProvider && (
        <Modal open onClose={() => setEditingProvider(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-0">
            <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
              <h3 className="text-lg font-semibold text-app-fg">Edit Provider</h3>
              <button
                type="button"
                onClick={() => setEditingProvider(null)}
                className="text-app-fg-muted hover:text-app-fg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <fetcher.Form method="post" className="px-6 py-4 space-y-4">
              <input type="hidden" name="intent" value="updateProvider" />
              <input type="hidden" name="providerId" value={editingProvider.id} />
              <TextInput
                name="name"
                type="text"
                label="Provider name"
                defaultValue={editingProvider.name}
                required
                placeholder="Provider name"
              />
              <TextInput
                name="contactInfo"
                type="text"
                label="Contact info"
                defaultValue={editingProvider.contactInfo ?? ''}
                placeholder="Phone, email, or contact name"
              />
              <TextInput
                name="coverageArea"
                type="text"
                label="Coverage area"
                defaultValue={editingProvider.coverageArea ?? ''}
                placeholder="e.g. Lagos, Abuja"
              />
              <FormSelect
                name="status"
                label="Status"
                defaultValue={editingProvider.status}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                  Save changes
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditingProvider(null)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Partner details view modal */}
      {viewingProvider && (
        <Modal open onClose={() => setViewingProvider(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Partner details</h3>
            <button
              type="button"
              onClick={() => setViewingProvider(null)}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-6 py-4 space-y-4">
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Name</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingProvider.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Contact info</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingProvider.contactInfo ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Coverage area</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingProvider.coverageArea ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Status</dt>
                <dd className="mt-0.5">
                  <StatusBadge status={viewingProvider.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Created</dt>
                <dd className="mt-0.5 text-sm text-app-fg-muted">
                  {new Date(viewingProvider.createdAt).toLocaleString('en-NG', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </dd>
              </div>
            </dl>
            <div>
              <h4 className="text-sm font-medium text-app-fg mb-2">Locations</h4>
              {locations.filter((l) => l.providerId === viewingProvider.id).length === 0 ? (
                <p className="text-sm text-app-fg-muted">No locations.</p>
              ) : (
                <ul className="space-y-2">
                  {locations
                    .filter((l) => l.providerId === viewingProvider.id)
                    .map((l) => (
                      <li key={l.id} className="rounded-lg border border-app-border p-3 text-sm">
                        <p className="font-medium text-app-fg">{l.name}</p>
                        <p className="text-app-fg-muted mt-0.5">{l.address}</p>
                        {l.coordinates && (
                          <p className="text-app-fg-muted mt-0.5 text-xs">{l.coordinates}</p>
                        )}
                        <div className="mt-1"><StatusBadge status={l.status} /></div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex gap-2 px-6 py-4 border-t border-app-border">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingProvider(viewingProvider);
                setViewingProvider(null);
              }}
            >
              Edit
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewingProvider(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'providers', label: `Providers (${totalProviders})` },
          { value: 'locations', label: `Locations (${totalLocations})` },
          ...(canViewEscalations
            ? [
                {
                  value: 'escalations' as const,
                  label: 'Escalations',
                  badge: healthDashboard ? (
                    <DeferredSection resolve={healthDashboard} skeleton="inline">
                      {(resolvedHealth) =>
                        resolvedHealth && resolvedHealth.totalEscalations > 0 ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold bg-red-500 text-white">
                            {resolvedHealth.totalEscalations}
                          </span>
                        ) : null
                      }
                    </DeferredSection>
                  ) : undefined,
                },
              ]
            : []),
        ]}
      />

      {/* Content */}
      {activeTab === 'providers' && (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Name</th>
                  <th className="table-header">Contact</th>
                  <th className="table-header">Coverage</th>
                  <th className="table-header">Status</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p: Provider) => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell font-medium text-app-fg">{p.name}</td>
                    <td className="table-cell text-app-fg-muted">{p.contactInfo ?? '—'}</td>
                    <td className="table-cell text-app-fg-muted">{p.coverageArea ?? '—'}</td>
                    <td className="table-cell">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingProvider(p)}
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingProvider(p)}
                        >
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {providers.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No logistics providers yet" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {providers.length === 0 ? (
              <EmptyState title="No logistics providers yet" />
            ) : (
              providers.map((p: Provider) => (
                <div key={p.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium text-app-fg">{p.name}</p>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-sm text-app-fg-muted space-y-0.5 mb-2">
                    {p.contactInfo && <div>Contact: {p.contactInfo}</div>}
                    {p.coverageArea && <div>Coverage: {p.coverageArea}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingProvider(p)}
                    >
                      View
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingProvider(p)}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'locations' && (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Location</th>
                  <th className="table-header">Address</th>
                  <th className="table-header">Provider</th>
                  <th className="table-header">Status</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l: Location) => {
                  const provider = providers.find((p: Provider) => p.id === l.providerId);
                  return (
                    <tr key={l.id} className="table-row">
                      <td className="table-cell font-medium text-app-fg">{l.name}</td>
                      <td className="table-cell text-app-fg-muted">{l.address}</td>
                      <td className="table-cell text-app-fg-muted">{provider?.name ?? l.providerId.slice(0, 8)}</td>
                      <td className="table-cell">
                        <StatusBadge status={l.status} />
                      </td>
                    </tr>
                  );
                })}
                {locations.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="No locations yet" description="Add a provider first, then add locations." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {locations.length === 0 ? (
              <EmptyState title="No locations yet" description="Add a provider first, then add locations." />
            ) : (
              locations.map((l: Location) => {
                const provider = providers.find((p: Provider) => p.id === l.providerId);
                return (
                  <div key={l.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-app-fg">{l.name}</p>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="text-sm text-app-fg-muted space-y-0.5">
                      <div>Address: {l.address}</div>
                      <div>Provider: {provider?.name ?? l.providerId.slice(0, 8)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'escalations' && canViewEscalations && healthDashboard && (
        <DeferredSection resolve={healthDashboard} skeleton="table">
          {(resolvedHealth) => resolvedHealth ? (
            <EscalationsPanel healthDashboard={resolvedHealth} />
          ) : (
            <div className="card">
              <p className="text-sm text-app-fg-muted text-center py-8">
                Unable to load escalation data. Please try again.
              </p>
            </div>
          )}
        </DeferredSection>
      )}

      {activeTab === 'escalations' && canViewEscalations && !healthDashboard && (
        <div className="card">
          <p className="text-sm text-app-fg-muted text-center py-8">
            Unable to load escalation data. Please try again.
          </p>
        </div>
      )}
    </div>
  );
}
