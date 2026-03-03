import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
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
            <p className="text-sm font-medium text-surface-900 dark:text-white">All clear</p>
            <p className="text-xs text-surface-800 dark:text-surface-400">No active escalations found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`card border-l-4 ${shrinkageAlerts.length > 0 ? 'border-l-red-500' : 'border-l-green-500'}`}>
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Shrinkage Alerts</p>
          <p className={`text-2xl font-bold mt-1 ${shrinkageAlerts.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-surface-900 dark:text-white'}`}>
            {shrinkageAlerts.length}
          </p>
        </div>
        <div className={`card border-l-4 ${stuckOrders.length > 0 ? 'border-l-yellow-500' : 'border-l-green-500'}`}>
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Stuck Orders (&gt;24h)</p>
          <p className={`text-2xl font-bold mt-1 ${stuckOrders.length > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-surface-900 dark:text-white'}`}>
            {stuckOrders.length}
          </p>
        </div>
        <div className={`card border-l-4 ${transferDelays.length > 0 ? 'border-l-orange-500' : 'border-l-green-500'}`}>
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Transfer Delays (&gt;48h)</p>
          <p className={`text-2xl font-bold mt-1 ${transferDelays.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-surface-900 dark:text-white'}`}>
            {transferDelays.length}
          </p>
        </div>
      </div>

      {/* Shrinkage Alerts Table */}
      {shrinkageAlerts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2 flex items-center gap-2">
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
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{alert.productName}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-400">
                      {alert.fromLocationName} → {alert.toLocationName}
                    </td>
                    <td className="table-cell text-right text-surface-700 dark:text-surface-300">{alert.quantitySent}</td>
                    <td className="table-cell text-right text-surface-700 dark:text-surface-300">{alert.quantityReceived ?? 0}</td>
                    <td className="table-cell text-right">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        -{alert.shortage}
                      </span>
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-400 text-xs">
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
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2 flex items-center gap-2">
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
                    <td className="table-cell font-mono text-xs text-surface-700 dark:text-surface-300">
                      {order.orderId.slice(0, 8)}...
                    </td>
                    <td className="table-cell">
                      <span className={
                        order.status === 'DISPATCHED'
                          ? 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                      }>
                        {order.status}
                      </span>
                    </td>
                    <td className="table-cell text-surface-700 dark:text-surface-300">{order.customerName}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-400">{order.riderName ?? '—'}</td>
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
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-2 flex items-center gap-2">
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
                    <td className="table-cell font-mono text-xs text-surface-700 dark:text-surface-300">
                      {transfer.transferId.slice(0, 8)}...
                    </td>
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{transfer.productName}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-400">
                      {transfer.fromLocationName} → {transfer.toLocationName}
                    </td>
                    <td className="table-cell text-right text-surface-700 dark:text-surface-300">{transfer.quantitySent}</td>
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
  const [activeTab, setActiveTab] = useState<'providers' | 'locations' | 'escalations'>('providers');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);

  const actionError = (fetcher.data as { error?: string })?.error;
  const actionSuccess = (fetcher.data as { success?: boolean })?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Logistics action completed' });

  // Close forms on success
  if (actionSuccess && showAddProvider) setShowAddProvider(false);
  if (actionSuccess && showAddLocation) setShowAddLocation(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Logistics</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Manage 3PL providers, locations, and delivery operations
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddProvider(!showAddProvider)} className="btn-secondary btn-sm">
            + Provider
          </button>
          <button onClick={() => setShowAddLocation(!showAddLocation)} className="btn-primary btn-sm">
            + Location
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* Stats */}
      <div className={`grid gap-3 ${canViewEscalations ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Providers</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalProviders}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Locations</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalLocations}</p>
        </div>
        {canViewEscalations && healthDashboard && (
          <DeferredSection resolve={healthDashboard} skeleton="stat">
            {(resolvedHealth) => resolvedHealth ? (
              <div className={`card border-l-4 ${resolvedHealth.totalEscalations > 0 ? 'border-l-red-500' : 'border-l-green-500'}`}>
                <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Escalations</p>
                <p className={`text-2xl font-bold mt-1 ${resolvedHealth.totalEscalations > 0 ? 'text-red-600 dark:text-red-400' : 'text-surface-900 dark:text-white'}`}>
                  {resolvedHealth.totalEscalations}
                </p>
              </div>
            ) : (
              <div className="card border-l-4 border-l-surface-300">
                <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Escalations</p>
                <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">--</p>
              </div>
            )}
          </DeferredSection>
        )}
      </div>

      {/* Add Provider Form */}
      {showAddProvider && (
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Add Provider</h3>
          <input type="hidden" name="intent" value="createProvider" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input name="name" type="text" required placeholder="Provider name" className="input" />
            <input name="contactInfo" type="text" placeholder="Contact info" className="input" />
            <input name="coverageArea" type="text" placeholder="Coverage area" className="input" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={fetcher.state === 'submitting'}>
              {fetcher.state === 'submitting' ? 'Creating...' : 'Create Provider'}
            </button>
            <button type="button" onClick={() => setShowAddProvider(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </fetcher.Form>
      )}

      {/* Add Location Form */}
      {showAddLocation && (
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Add Location</h3>
          <input type="hidden" name="intent" value="createLocation" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select name="providerId" required className="input">
              <option value="">Select provider...</option>
              {providers.map((p: Provider) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input name="name" type="text" required placeholder="Location name" className="input" />
            <input name="address" type="text" required placeholder="Address" className="input" />
            <input name="coordinates" type="text" placeholder="GPS coordinates (optional)" className="input" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={fetcher.state === 'submitting'}>
              {fetcher.state === 'submitting' ? 'Creating...' : 'Create Location'}
            </button>
            <button type="button" onClick={() => setShowAddLocation(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </fetcher.Form>
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
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Contact</th>
                <th className="table-header">Coverage</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p: Provider) => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{p.name}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">{p.contactInfo ?? '—'}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">{p.coverageArea ?? '—'}</td>
                  <td className="table-cell">
                    <span className={p.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}>{p.status}</span>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    No logistics providers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'locations' && (
        <div className="card p-0 overflow-hidden">
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
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{l.name}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-400">{l.address}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-400">{provider?.name ?? l.providerId.slice(0, 8)}</td>
                    <td className="table-cell">
                      <span className={l.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}>{l.status}</span>
                    </td>
                  </tr>
                );
              })}
              {locations.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    No locations yet. Add a provider first, then add locations.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'escalations' && canViewEscalations && healthDashboard && (
        <DeferredSection resolve={healthDashboard} skeleton="table">
          {(resolvedHealth) => resolvedHealth ? (
            <EscalationsPanel healthDashboard={resolvedHealth} />
          ) : (
            <div className="card">
              <p className="text-sm text-surface-800 dark:text-surface-400 text-center py-8">
                Unable to load escalation data. Please try again.
              </p>
            </div>
          )}
        </DeferredSection>
      )}

      {activeTab === 'escalations' && canViewEscalations && !healthDashboard && (
        <div className="card">
          <p className="text-sm text-surface-800 dark:text-surface-400 text-center py-8">
            Unable to load escalation data. Please try again.
          </p>
        </div>
      )}
    </div>
  );
}
