import { useState, useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcher, useRevalidator } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import type {
  Provider,
  Location,
} from './types';

interface LogisticsPageProps {
  providers: Provider[];
  totalProviders: number;
  locations: Location[];
  totalLocations: number;
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
              label={idx === 0 ? 'Logistics company name' : undefined}
              value={row.name}
              onChange={(e) => updateRow(idx, 'name', e.target.value)}
              placeholder="Logistics company name"
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
          {filledCount > 1 ? `Create ${filledCount} logistics companies` : 'Create logistics company'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

export function LogisticsPage({ providers, totalProviders, locations, totalLocations }: LogisticsPageProps) {
  const fetcher = useFetcher();
  const { revalidate, state: revalidatorState } = useRevalidator();
  const [activeTab, setActiveTab] = useState<'providers' | 'locations'>('providers');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [addLocationProviderId, setAddLocationProviderId] = useState('');
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [viewingProvider, setViewingProvider] = useState<Provider | null>(null);
  const [viewingLocation, setViewingLocation] = useState<Location | null>(null);

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
        description="Manage 3PL logistics companies, locations, and delivery operations"
        actions={
          <div className="flex gap-2">
            <PageRefreshButton />
            <Button variant="secondary" size="sm" onClick={() => setShowAddProvider(true)}>
              + Logistics company
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setAddLocationProviderId('');
                setShowAddLocation(true);
              }}
            >
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

      <OverviewStatStrip
        showScrollControls={false}
        items={[
          { label: 'Logistics companies', value: totalProviders, valueClassName: 'text-app-fg' },
          { label: 'Locations', value: totalLocations, valueClassName: 'text-app-fg' },
        ]}
      />

      {/* Add logistics company modal */}
      {showAddProvider && (
        <Modal open onClose={() => setShowAddProvider(false)} maxWidth="max-w-2xl" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Add logistics company</h3>
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
        <Modal
          open
          onClose={() => {
            setShowAddLocation(false);
            setAddLocationProviderId('');
          }}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-0"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Add Location</h3>
            <button
              type="button"
              onClick={() => {
                setShowAddLocation(false);
                setAddLocationProviderId('');
              }}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <fetcher.Form method="post" className="px-6 py-4 space-y-4">
            <input type="hidden" name="intent" value="createLocation" />
            <input type="hidden" name="providerId" value={addLocationProviderId} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
              <SearchableSelect
                id="add-location-provider"
                label="Logistics company"
                required
                value={addLocationProviderId}
                onChange={setAddLocationProviderId}
                options={providers.map((p: Provider) => ({ value: p.id, label: p.name }))}
                placeholder="Select logistics company…"
                searchPlaceholder="Search companies…"
              />
              <TextInput
                id="add-location-name"
                name="name"
                type="text"
                label="Location name"
                required
                placeholder="e.g. Ikeja hub"
              />
              <TextInput
                id="add-location-address"
                name="address"
                type="text"
                label="Address"
                required
                placeholder="Street, city, state"
              />
              <TextInput
                id="add-location-coordinates"
                name="coordinates"
                type="text"
                label="GPS coordinates"
                placeholder="Lat, long"
                hint="Optional map pin for dispatch."
              />
              <TextInput
                id="add-location-whatsapp"
                name="whatsappGroupLink"
                type="url"
                label="WhatsApp group link"
                placeholder="https://chat.whatsapp.com/…"
                hint="Used by the CS Share to logistics company flow. Optional."
                wrapperClassName="sm:col-span-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowAddLocation(false);
                  setAddLocationProviderId('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!addLocationProviderId}
                loading={fetcher.state === 'submitting'}
                loadingText="Creating..."
              >
                Create Location
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Edit logistics company modal */}
      {editingProvider && (
        <Modal open onClose={() => setEditingProvider(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-0">
            <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
              <h3 className="text-lg font-semibold text-app-fg">Edit logistics company</h3>
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
                label="Logistics company name"
                defaultValue={editingProvider.name}
                required
                placeholder="Logistics company name"
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

      {/* Location details view modal */}
      {viewingLocation && (
        <Modal open onClose={() => setViewingLocation(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Location details</h3>
            <button
              type="button"
              onClick={() => setViewingLocation(null)}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-6 py-4 space-y-4">
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Location name</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingLocation.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Logistics company</dt>
                <dd className="mt-0.5 text-sm text-app-fg">
                  {providers.find((p) => p.id === viewingLocation.providerId)?.name ?? 'Unknown logistics company'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Address</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingLocation.address}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">GPS coordinates</dt>
                <dd className="mt-0.5 text-sm text-app-fg">{viewingLocation.coordinates ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">WhatsApp group</dt>
                <dd className="mt-0.5 text-sm break-all">
                  {viewingLocation.whatsappGroupLink ? (
                    <a
                      href={viewingLocation.whatsappGroupLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-500 hover:text-brand-600 underline"
                    >
                      {viewingLocation.whatsappGroupLink}
                    </a>
                  ) : (
                    <span className="text-app-fg-muted">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Status</dt>
                <dd className="mt-0.5">
                  <StatusBadge status={viewingLocation.status} />
                </dd>
              </div>
              {viewingLocation.dispatchLocked === true && (
                <div>
                  <dt className="text-xs font-medium text-app-fg-muted">Dispatch</dt>
                  <dd className="mt-0.5">
                    <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Locked (reconciliation required)
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Created</dt>
                <dd className="mt-0.5 text-sm text-app-fg-muted">
                  {new Date(viewingLocation.createdAt).toLocaleString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex gap-2 px-6 py-4 border-t border-app-border">
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewingLocation(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Partner details view modal */}
      {viewingProvider && (
        <Modal open onClose={() => setViewingProvider(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Logistics company details</h3>
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
          { value: 'providers', label: `Companies (${totalProviders})` },
          { value: 'locations', label: `Locations (${totalLocations})` },
        ]}
      />

      {/* Content */}
      {activeTab === 'providers' && (
        <div className="card p-0">
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
                      <EmptyState title="No logistics companies yet" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {providers.length === 0 ? (
              <EmptyState title="No logistics companies yet" />
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
        <div className="card p-0">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Location</th>
                  <th className="table-header">Address</th>
                  <th className="table-header">Logistics company</th>
                  <th className="table-header">Status</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l: Location) => {
                  const provider = providers.find((p: Provider) => p.id === l.providerId);
                  return (
                    <tr key={l.id} className="table-row">
                      <td className="table-cell font-medium text-app-fg">{l.name}</td>
                      <td className="table-cell text-app-fg-muted">{l.address}</td>
                      <td className="table-cell text-app-fg-muted">{provider?.name ?? 'Unknown logistics company'}</td>
                      <td className="table-cell">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="table-cell text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setViewingLocation(l)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {locations.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No locations yet" description="Add a logistics company first, then add locations." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {locations.length === 0 ? (
              <EmptyState title="No locations yet" description="Add a logistics company first, then add locations." />
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
                      <div>Logistics company: {provider?.name ?? 'Unknown logistics company'}</div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setViewingLocation(l)}>
                        View
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

    </div>
  );
}
