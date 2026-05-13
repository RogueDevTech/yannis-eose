import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { Modal } from '~/components/ui/modal';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import {
  applyOptimisticPatches,
  isOptimisticPatched,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { PageNotification } from '~/components/ui/page-notification';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ActionDropdown } from '~/components/ui/action-dropdown';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
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
  submissionError,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onCancel: () => void;
  submissionError?: string | null;
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

  const filledCount = rows.filter(
    (r) => r.name.trim() && r.contactInfo.trim() && r.coverageArea.trim(),
  ).length;

  return (
    <fetcher.Form method="post" className="px-6 py-4 space-y-3">
      <ModalFetcherInlineError message={submissionError} className="mb-1" />
      <div className="flex items-center justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          + Add another
        </Button>
      </div>
      <input type="hidden" name="intent" value={rows.length > 1 ? 'createProviders' : 'createProvider'} />
      <div className="space-y-3">
        {rows.map((row, idx) => {
          const partialRow =
            row.name.trim().length > 0 ||
            row.contactInfo.trim().length > 0 ||
            row.coverageArea.trim().length > 0;
          const rowRequired = idx === 0 || partialRow;
          return (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <TextInput
              name={rows.length > 1 ? `provider_${idx}_name` : 'name'}
              type="text"
              label={idx === 0 ? 'Logistics company name' : undefined}
              value={row.name}
              onChange={(e) => updateRow(idx, 'name', e.target.value)}
              placeholder="Logistics company name"
              required={rowRequired}
            />
            <TextInput
              name={rows.length > 1 ? `provider_${idx}_contactInfo` : 'contactInfo'}
              type="text"
              label={idx === 0 ? 'Contact info' : undefined}
              value={row.contactInfo}
              onChange={(e) => updateRow(idx, 'contactInfo', e.target.value)}
              placeholder="Phone, email, or contact name"
              required={rowRequired}
            />
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <TextInput
                  name={rows.length > 1 ? `provider_${idx}_coverageArea` : 'coverageArea'}
                  type="text"
                  label={idx === 0 ? 'Coverage area' : undefined}
                  value={row.coverageArea}
                  onChange={(e) => updateRow(idx, 'coverageArea', e.target.value)}
                  placeholder="e.g. Lagos, Kogi"
                  required={rowRequired}
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
          );
        })}
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
  const [activeTab, setActiveTab] = useState<'providers' | 'locations'>('providers');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [addLocationProviderId, setAddLocationProviderId] = useState('');
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [viewingProvider, setViewingProvider] = useState<Provider | null>(null);
  const [viewingLocation, setViewingLocation] = useState<Location | null>(null);

  const fetcherSurface = useFetcherActionSurface(fetcher);
  const actionError = fetcherSurface.rawError;
  const friendlyError = fetcherSurface.friendlyError;
  const mutationModalOpen = showAddProvider || showAddLocation || !!editingProvider || !!editingLocation;
  const [dismissedError, setDismissedError] = useState(false);
  /** Single open-menu id shared by the page-header "+ Logistics company" /
   *  "+ Location" dropdowns so opening one closes the other. */
  const [openHeaderMenuId, setOpenHeaderMenuId] = useState<string | null>(null);
  useFetcherToast(fetcher.data, {
    successMessage: 'Logistics action completed',
    skipErrorToast: mutationModalOpen,
  });

  // Optimistic-row derivation — see the canonical pattern in
  // `~/hooks/useOptimisticListMerge`. We extract synthetic Provider /
  // Location rows from the in-flight `fetcher.formData` so the table shows
  // the new entry the instant the user submits.
  const buildOptimisticProviders = useCallback(
    (fd: FormData, intent: string): Provider[] | null => {
      const now = new Date().toISOString();
      if (intent === 'createProvider') {
        const name = fd.get('name')?.toString().trim();
        const contactInfo = fd.get('contactInfo')?.toString().trim();
        const coverageArea = fd.get('coverageArea')?.toString().trim();
        if (!name || !contactInfo || !coverageArea) return null;
        return [
          {
            id: optimisticId(),
            name,
            contactInfo,
            coverageArea,
            status: 'ACTIVE',
            createdAt: now,
          },
        ];
      }
      if (intent === 'createProviders') {
        const out: Provider[] = [];
        for (let i = 0; i < 50; i++) {
          const name = fd.get(`provider_${i}_name`)?.toString().trim();
          const contactInfo = fd.get(`provider_${i}_contactInfo`)?.toString().trim();
          const coverageArea = fd.get(`provider_${i}_coverageArea`)?.toString().trim();
          if (!name) continue;
          if (!contactInfo || !coverageArea) continue;
          out.push({
            id: optimisticId(i),
            name,
            contactInfo,
            coverageArea,
            status: 'ACTIVE',
            createdAt: now,
          });
        }
        return out.length === 0 ? null : out;
      }
      return null;
    },
    [],
  );
  const optimisticProviders = useOptimisticListMerge<Provider>(fetcher, buildOptimisticProviders);

  const buildOptimisticLocations = useCallback(
    (fd: FormData, intent: string): Location[] | null => {
      if (intent !== 'createLocation') return null;
      const name = fd.get('name')?.toString().trim();
      const providerId = fd.get('providerId')?.toString().trim();
      if (!name || !providerId) return null;
      const providerName = providers.find((p) => p.id === providerId)?.name ?? null;
      return [
        {
          id: optimisticId(),
          providerId,
          name,
          address: fd.get('address')?.toString().trim() ?? '',
          coordinates: fd.get('coordinates')?.toString().trim() || null,
          whatsappGroupLink: fd.get('whatsappGroupLink')?.toString().trim() || null,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          providerName,
        },
      ];
    },
    [providers],
  );
  const optimisticLocations = useOptimisticListMerge<Location>(fetcher, buildOptimisticLocations);

  /** Optimistic-edit overlay for `updateProvider` — overlay the new field values
   *  on the matching server row by id so the table updates the same tick the
   *  toast fires. Snaps back if the action fails. */
  const buildProviderPatches = useCallback<
    (fd: FormData, intent: string) => { id: string; patch: Partial<Provider> }[] | null
  >((fd, intent) => {
    if (intent !== 'updateProvider') return null;
    const id = fd.get('providerId')?.toString();
    if (!id) return null;
    const patch: Partial<Provider> = {};
    const name = fd.get('name')?.toString().trim();
    if (name) patch.name = name;
    const contactInfo = fd.get('contactInfo')?.toString().trim();
    const coverageArea = fd.get('coverageArea')?.toString().trim();
    if (contactInfo) patch.contactInfo = contactInfo;
    if (coverageArea) patch.coverageArea = coverageArea;
    const status = fd.get('status')?.toString();
    if (status) patch.status = status;
    return [{ id, patch }];
  }, []);
  const providerPatches = useOptimisticListPatches<Provider>(fetcher, buildProviderPatches);

  const buildLocationPatches = useCallback<
    (fd: FormData, intent: string) => { id: string; patch: Partial<Location> }[] | null
  >((fd, intent) => {
    if (intent !== 'updateLocation') return null;
    const id = fd.get('locationId')?.toString();
    if (!id) return null;
    const patch: Partial<Location> = {};
    const name = fd.get('name')?.toString().trim();
    const address = fd.get('address')?.toString().trim();
    if (name) patch.name = name;
    if (address) patch.address = address;
    const coordinates = fd.get('coordinates')?.toString().trim();
    if (coordinates !== undefined) patch.coordinates = coordinates || null;
    const whatsapp = fd.get('whatsappGroupLink')?.toString().trim();
    if (whatsapp !== undefined) patch.whatsappGroupLink = whatsapp || null;
    const status = fd.get('status')?.toString();
    if (status) patch.status = status;
    return [{ id, patch }];
  }, []);
  const locationPatches = useOptimisticListPatches<Location>(fetcher, buildLocationPatches);

  /** Server data + any in-flight optimistic rows (adds + edits). Loader
   * revalidation replaces these synthetic rows with canonical data once it
   * lands. */
  const displayProviders = useMemo(
    () => [...optimisticProviders, ...applyOptimisticPatches(providers, providerPatches)],
    [providers, optimisticProviders, providerPatches],
  );
  const displayLocations = useMemo(
    () => [...optimisticLocations, ...applyOptimisticPatches(locations, locationPatches)],
    [locations, optimisticLocations, locationPatches],
  );
  const displayTotalProviders = totalProviders + optimisticProviders.length;
  const displayTotalLocations = totalLocations + optimisticLocations.length;

  const providerTableColumns: CompactTableColumn<Provider>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (p) => (
          <>
            <span className="font-medium text-app-fg">{p.name}</span>
            {isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id) ? (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-app-fg-muted">Saving…</span>
            ) : null}
          </>
        ),
      },
      {
        key: 'contact',
        header: 'Contact',
        render: (p) => <span className="text-app-fg-muted">{p.contactInfo ?? '—'}</span>,
      },
      {
        key: 'coverage',
        header: 'Coverage',
        render: (p) => <span className="text-app-fg-muted">{p.coverageArea ?? '—'}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => <StatusBadge status={p.status} />,
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (p) => {
          const isOptimistic = isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id);
          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <CompactTableActionButton disabled={isOptimistic} onClick={() => setViewingProvider(p)}>
                View
              </CompactTableActionButton>
              <CompactTableActionButton
                className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
                disabled={isOptimistic}
                onClick={() => setEditingProvider(p)}
              >
                Edit
              </CompactTableActionButton>
            </div>
          );
        },
      },
    ],
    [providerPatches],
  );

  const locationTableColumns: CompactTableColumn<Location>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Location',
        render: (l) => (
          <>
            <span className="font-medium text-app-fg">{l.name}</span>
            {isOptimisticId(l.id) ? (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-app-fg-muted">Saving…</span>
            ) : null}
          </>
        ),
      },
      {
        key: 'address',
        header: 'Address',
        render: (l) => <span className="text-app-fg-muted">{l.address}</span>,
      },
      {
        key: 'provider',
        header: 'Logistics company',
        render: (l) => {
          const provider = displayProviders.find((p: Provider) => p.id === l.providerId);
          return <span className="text-app-fg-muted">{provider?.name ?? 'Unknown logistics company'}</span>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (l) => <StatusBadge status={l.status} />,
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (l) => {
          const isOptimistic = isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id);
          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <CompactTableActionButton disabled={isOptimistic} onClick={() => setViewingLocation(l)}>
                View
              </CompactTableActionButton>
              <CompactTableActionButton
                className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
                disabled={isOptimistic}
                onClick={() => setEditingLocation(l)}
              >
                Edit
              </CompactTableActionButton>
            </div>
          );
        },
      },
    ],
    [displayProviders, locationPatches],
  );

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close-on-success — see `~/hooks/useCloseOnFetcherSuccess`. Fires the
  // instant `fetcher.data` flips to a success payload, the same tick the
  // toast appears. Reads fetcher.data by reference (not a derived boolean,
  // not fetcher.state === 'idle') so every fresh response fires once and
  // there's no loader-revalidation lag.
  const handleFetcherSuccess = useCallback(() => {
    setShowAddProvider(false);
    setShowAddLocation(false);
    setEditingProvider(null);
    setEditingLocation(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleFetcherSuccess);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logistics"
        mobileInlineActions
        description="Manage logistics companies and locations."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Logistics tools"
            sheetSubtitle={<span>Refresh and add records</span>}
            triggerAriaLabel="Logistics toolbar"
            desktop={
              <div className="flex flex-wrap gap-2">
                <PageRefreshButton />
                <ActionDropdown
                  id="add-company"
                  trigger="button"
                  triggerLabel="+ Logistics company"
                  triggerVariant="secondary"
                  openMenuId={openHeaderMenuId}
                  setOpenMenuId={setOpenHeaderMenuId}
                  items={[
                    {
                      label: 'Add manually',
                      onClick: () => setShowAddProvider(true),
                    },
                    {
                      label: 'Import from Excel',
                      to: '/admin/logistics/partners/import-providers',
                    },
                  ]}
                />
                <ActionDropdown
                  id="add-location"
                  trigger="button"
                  triggerLabel="+ Location"
                  triggerVariant="primary"
                  openMenuId={openHeaderMenuId}
                  setOpenMenuId={setOpenHeaderMenuId}
                  items={[
                    {
                      label: 'Add manually',
                      onClick: () => {
                        setAddLocationProviderId('');
                        setShowAddLocation(true);
                      },
                    },
                    {
                      label: 'Import from Excel',
                      to: '/admin/logistics/partners/import-locations',
                    },
                  ]}
                />
              </div>
            }
            sheet={
              <>
                <ActionDropdown
                  id="add-company-mobile"
                  trigger="button"
                  triggerLabel="+ Logistics company"
                  triggerVariant="secondary"
                  openMenuId={openHeaderMenuId}
                  setOpenMenuId={setOpenHeaderMenuId}
                  items={[
                    {
                      label: 'Add manually',
                      onClick: () => setShowAddProvider(true),
                    },
                    {
                      label: 'Import from Excel',
                      to: '/admin/logistics/partners/import-providers',
                    },
                  ]}
                />
                <ActionDropdown
                  id="add-location-mobile"
                  trigger="button"
                  triggerLabel="+ Location"
                  triggerVariant="primary"
                  openMenuId={openHeaderMenuId}
                  setOpenMenuId={setOpenHeaderMenuId}
                  items={[
                    {
                      label: 'Add manually',
                      onClick: () => {
                        setAddLocationProviderId('');
                        setShowAddLocation(true);
                      },
                    },
                    {
                      label: 'Import from Excel',
                      to: '/admin/logistics/partners/import-locations',
                    },
                  ]}
                />
              </>
            }
          />
        }
      />

      {actionError && !dismissedError && !mutationModalOpen && (
        <PageNotification
          variant="error"
          message={friendlyError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip
        showScrollControls={false}
        items={[
          { label: 'Logistics companies', value: displayTotalProviders, valueClassName: 'text-app-fg' },
          { label: 'Locations', value: displayTotalLocations, valueClassName: 'text-app-fg' },
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
            submissionError={fetcherSurface.errorMatchingIntent(['createProvider', 'createProviders'])}
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
            <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('createLocation')} />
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
              <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('updateProvider')} />
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
                required
              />
              <TextInput
                name="coverageArea"
                type="text"
                label="Coverage area"
                defaultValue={editingProvider.coverageArea ?? ''}
                placeholder="e.g. Lagos, Abuja"
                required
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
                  {displayProviders.find((p) => p.id === viewingLocation.providerId)?.name ?? 'Unknown logistics company'}
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
          <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-app-border">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingLocation(viewingLocation);
                setViewingLocation(null);
              }}
            >
              Edit
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewingLocation(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Edit location modal */}
      {editingLocation && (
        <Modal
          key={editingLocation.id}
          open
          onClose={() => setEditingLocation(null)}
          maxWidth="max-w-2xl"
          backdropBlur
          contentClassName="p-0"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg">Edit location</h3>
            <button
              type="button"
              onClick={() => setEditingLocation(null)}
              className="text-app-fg-muted hover:text-app-fg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <fetcher.Form method="post" className="px-6 py-4 space-y-4">
            <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('updateLocation')} />
            <input type="hidden" name="intent" value="updateLocation" />
            <input type="hidden" name="locationId" value={editingLocation.id} />
            <div>
              <p className="text-xs font-medium text-app-fg-muted">Logistics company</p>
              <p className="mt-0.5 text-sm text-app-fg">
                {displayProviders.find((p) => p.id === editingLocation.providerId)?.name ?? 'Unknown logistics company'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
              <TextInput
                id="edit-location-name"
                name="name"
                type="text"
                label="Location name"
                required
                defaultValue={editingLocation.name}
                placeholder="e.g. Ikeja hub"
              />
              <TextInput
                id="edit-location-address"
                name="address"
                type="text"
                label="Address"
                required
                defaultValue={editingLocation.address}
                placeholder="Street, city, state"
              />
              <TextInput
                id="edit-location-coordinates"
                name="coordinates"
                type="text"
                label="GPS coordinates"
                defaultValue={editingLocation.coordinates ?? ''}
                placeholder="Lat, long"
                hint="Optional map pin for dispatch."
              />
              <TextInput
                id="edit-location-whatsapp"
                name="whatsappGroupLink"
                type="url"
                label="WhatsApp group link"
                defaultValue={editingLocation.whatsappGroupLink ?? ''}
                placeholder="https://chat.whatsapp.com/…"
                hint="Leave empty to remove. Used by the CS Share to logistics company flow."
                wrapperClassName="sm:col-span-2"
              />
              <FormSelect
                name="status"
                label="Status"
                defaultValue={editingLocation.status}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
                wrapperClassName="sm:col-span-2"
              />
            </div>
            {editingLocation.dispatchLocked === true && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Dispatch is locked on this location (reconciliation). You can still update contact details and status.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                Save changes
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingLocation(null)}>
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
              {displayLocations.filter((l) => l.providerId === viewingProvider.id).length === 0 ? (
                <p className="text-sm text-app-fg-muted">No locations.</p>
              ) : (
                <ul className="space-y-2">
                  {displayLocations
                    .filter((l) => l.providerId === viewingProvider.id)
                    .map((l) => {
                      const locBusy = isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id);
                      return (
                        <li
                          key={l.id}
                          className="flex flex-col gap-2 rounded-lg border border-app-border p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-app-fg">{l.name}</p>
                            <p className="text-app-fg-muted mt-0.5">{l.address}</p>
                            {l.coordinates ? (
                              <p className="text-app-fg-muted mt-0.5 text-xs">{l.coordinates}</p>
                            ) : null}
                            <div className="mt-1">
                              <StatusBadge status={l.status} />
                            </div>
                          </div>
                          <CompactTableActionButton
                            className="shrink-0 self-end sm:self-start"
                            disabled={locBusy}
                            onClick={() => {
                              setEditingLocation(l);
                              setViewingProvider(null);
                            }}
                          >
                            Edit
                          </CompactTableActionButton>
                        </li>
                      );
                    })}
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
          { value: 'providers', label: `Companies (${displayTotalProviders})` },
          { value: 'locations', label: `Locations (${displayTotalLocations})` },
        ]}
      />

      {/* Content */}
      {activeTab === 'providers' && (
        <CompactTable<Provider>
          columns={providerTableColumns}
          rows={displayProviders}
          rowKey={(p) => p.id}
          rowClassName={(p) =>
            isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id) ? 'opacity-60' : ''
          }
          emptyTitle="No logistics companies yet"
        />
      )}

      {activeTab === 'locations' && (
        <CompactTable<Location>
          columns={locationTableColumns}
          rows={displayLocations}
          rowKey={(l) => l.id}
          rowClassName={(l) =>
            isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id) ? 'opacity-60' : ''
          }
          emptyTitle="No locations yet"
          emptyDescription="Add a logistics company first, then add locations."
        />
      )}

    </div>
  );
}
