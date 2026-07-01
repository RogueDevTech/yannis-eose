import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { Link, useFetcher } from '@remix-run/react';
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
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { Pagination } from '~/components/ui/pagination';
import { TableRowActionsSheet, type TableRowSheetAction } from '~/components/ui/table-row-actions-sheet';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import type {
  Provider,
  Location,
} from './types';

interface LogisticsPageProps {
  providers: Provider[];
  totalProviders: number;
  locations: Location[];
  totalLocations: number;
  globalLowStockThreshold: number;
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

/** 36 Nigerian states + FCT. */
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nassarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

/** Keywords that map fuzzy address/area text to a canonical Nigerian state. */
const STATE_ALIASES: Record<string, string> = {
  abuja: 'FCT Abuja', fct: 'FCT Abuja', nassarawa: 'Nassarawa', nasarawa: 'Nassarawa',
  lagos: 'Lagos', ogun: 'Ogun', oyo: 'Oyo', osun: 'Osun', ondo: 'Ondo', ekiti: 'Ekiti',
  edo: 'Edo', benin: 'Edo', delta: 'Delta', warri: 'Delta', asaba: 'Delta',
  anambra: 'Anambra', onitsha: 'Anambra', awka: 'Anambra', enugu: 'Enugu',
  abia: 'Abia', aba: 'Abia', imo: 'Imo', owerri: 'Imo', ebonyi: 'Ebonyi',
  rivers: 'Rivers', portharcourt: 'Rivers', 'port harcourt': 'Rivers', ph: 'Rivers',
  bayelsa: 'Bayelsa', 'cross river': 'Cross River', calabar: 'Cross River',
  'akwa ibom': 'Akwa Ibom', uyo: 'Akwa Ibom',
  kano: 'Kano', kaduna: 'Kaduna', katsina: 'Katsina', kebbi: 'Kebbi',
  sokoto: 'Sokoto', zamfara: 'Zamfara', jigawa: 'Jigawa',
  borno: 'Borno', maiduguri: 'Borno', yobe: 'Yobe', bauchi: 'Bauchi',
  gombe: 'Gombe', adamawa: 'Adamawa', taraba: 'Taraba',
  plateau: 'Plateau', jos: 'Plateau', benue: 'Benue',
  niger: 'Niger', minna: 'Niger', kwara: 'Kwara', ilorin: 'Kwara',
  kogi: 'Kogi', nassawara: 'Nassarawa',
  ibadan: 'Oyo', abeokuta: 'Ogun', ijebu: 'Ogun', mowe: 'Ogun', 'ibafo': 'Ogun',
  badagry: 'Lagos', ikeja: 'Lagos', island: 'Lagos', surulere: 'Lagos',
};

/** Best-effort state detection from a location's address / name / provider coverage. */
function detectState(loc: Location, providerCoverage?: string | null): string | null {
  const haystack = [loc.name, loc.address, providerCoverage ?? ''].join(' ').toLowerCase();
  for (const [keyword, state] of Object.entries(STATE_ALIASES)) {
    if (haystack.includes(keyword)) return state;
  }
  return null;
}

export function LogisticsPage({ providers, totalProviders, locations, totalLocations, globalLowStockThreshold }: LogisticsPageProps) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'providers' | 'locations'>('locations');
  const [search, setSearch] = useState('');
  const [filterProviderId, setFilterProviderId] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterHasStock, setFilterHasStock] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stock-asc' | 'stock-desc' | 'provider'>('name');
  const [providerSortBy, setProviderSortBy] = useState<'name' | 'status' | 'stock-desc' | 'stock-asc'>('name');
  const [filterProviderStatus, setFilterProviderStatus] = useState('');
  const [filterProviderHasStock, setFilterProviderHasStock] = useState('');
  const [locPage, setLocPage] = useState(1);
  const [provPage, setProvPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [addLocationProviderId, setAddLocationProviderId] = useState('');
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [viewingProvider, setViewingProvider] = useState<Provider | null>(null);
  const [viewingLocation, setViewingLocation] = useState<Location | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<Provider | null>(null);
  const [deleteLocation, setDeleteLocation] = useState<Location | null>(null);
  const [showExport, setShowExport] = useState(false);
  const deleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const deleteSubmitting = deleteFetcher.state !== 'idle';
  useFetcherToast(deleteFetcher.data, { successMessage: 'Removed successfully' });
  useCloseOnFetcherSuccess(deleteFetcher, useCallback(() => {
    setDeleteProvider(null);
    setDeleteLocation(null);
  }, []));

  const fetcherSurface = useFetcherActionSurface(fetcher);
  const actionError = fetcherSurface.rawError;
  const friendlyError = fetcherSurface.friendlyError;
  const mutationModalOpen = showAddProvider || showAddLocation || !!editingProvider || !!editingLocation;
  const [dismissedError, setDismissedError] = useState(false);
  /** Single open-menu id shared by the page-header "+ Logistics company" /
   *  "+ Location" dropdowns so opening one closes the other. */
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
      const lowStockRaw = fd.get('lowStockThreshold')?.toString().trim() ?? '';
      const lowStockParsed = lowStockRaw === '' ? null : Number.parseInt(lowStockRaw, 10);
      return [
        {
          id: optimisticId(),
          providerId,
          name,
          address: fd.get('address')?.toString().trim() ?? '',
          coordinates: fd.get('coordinates')?.toString().trim() || null,
          whatsappGroupLink: fd.get('whatsappGroupLink')?.toString().trim() || null,
          lowStockThreshold: Number.isFinite(lowStockParsed) ? (lowStockParsed as number) : null,
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
    const lowStockRaw = fd.get('lowStockThreshold');
    if (lowStockRaw !== null) {
      const lowStockStr = lowStockRaw.toString().trim();
      if (lowStockStr === '') {
        patch.lowStockThreshold = null;
      } else {
        const parsed = Number.parseInt(lowStockStr, 10);
        if (Number.isFinite(parsed)) patch.lowStockThreshold = parsed;
      }
    }
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

  /** Client-side search over the rows already loaded for the active tab. */
  const searchQuery = search.trim().toLowerCase();
  const getProviderTotalStock = useCallback((providerId: string) => {
    return displayLocations.filter((l) => l.providerId === providerId).reduce((sum, l) => sum + (l.totalStock ?? 0), 0);
  }, [displayLocations]);

  const filteredProviders = useMemo(() => {
    let result = displayProviders;
    if (filterProviderStatus) {
      result = result.filter((p) => p.status === filterProviderStatus);
    }
    if (filterProviderHasStock === 'has_stock') {
      result = result.filter((p) => getProviderTotalStock(p.id) > 0);
    } else if (filterProviderHasStock === 'no_stock') {
      result = result.filter((p) => getProviderTotalStock(p.id) === 0);
    }
    if (searchQuery) {
      result = result.filter((p) =>
        [p.name, p.contactInfo, p.coverageArea].some((field) =>
          (field ?? '').toLowerCase().includes(searchQuery),
        ),
      );
    }
    const sorted = [...result];
    if (providerSortBy === 'status') {
      sorted.sort((a, b) => (a.status ?? '').localeCompare(b.status ?? ''));
    } else if (providerSortBy === 'stock-desc') {
      sorted.sort((a, b) => getProviderTotalStock(b.id) - getProviderTotalStock(a.id));
    } else if (providerSortBy === 'stock-asc') {
      sorted.sort((a, b) => getProviderTotalStock(a.id) - getProviderTotalStock(b.id));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [displayProviders, searchQuery, filterProviderStatus, filterProviderHasStock, providerSortBy, getProviderTotalStock]);
  const filteredLocations = useMemo(() => {
    let result = displayLocations;
    if (filterProviderId) {
      result = result.filter((l) => l.providerId === filterProviderId);
    }
    if (filterState) {
      result = result.filter((l) => {
        const provider = displayProviders.find((p) => p.id === l.providerId);
        return detectState(l, provider?.coverageArea) === filterState;
      });
    }
    if (filterHasStock === 'has_stock') {
      result = result.filter((l) => (l.totalStock ?? 0) > 0);
    } else if (filterHasStock === 'no_stock') {
      result = result.filter((l) => (l.totalStock ?? 0) === 0);
    }
    if (searchQuery) {
      result = result.filter((l) =>
        [l.name, l.address, l.providerName].some((field) =>
          (field ?? '').toLowerCase().includes(searchQuery),
        ),
      );
    }
    // Sort
    const sorted = [...result];
    switch (sortBy) {
      case 'stock-desc':
        sorted.sort((a, b) => (b.totalStock ?? 0) - (a.totalStock ?? 0));
        break;
      case 'stock-asc':
        sorted.sort((a, b) => (a.totalStock ?? 0) - (b.totalStock ?? 0));
        break;
      case 'provider':
        sorted.sort((a, b) => (a.providerName ?? '').localeCompare(b.providerName ?? ''));
        break;
      case 'name':
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return sorted;
  }, [displayLocations, displayProviders, filterProviderId, filterState, filterHasStock, searchQuery, sortBy]);

  /** Nigerian states that actually appear in the current location data. */
  const availableStates = useMemo(() => {
    const stateSet = new Set<string>();
    for (const loc of displayLocations) {
      const provider = displayProviders.find((p) => p.id === loc.providerId);
      const state = detectState(loc, provider?.coverageArea);
      if (state) stateSet.add(state);
    }
    return NIGERIAN_STATES.filter((s) => stateSet.has(s));
  }, [displayLocations, displayProviders]);

  // Reset page when filters change
  useEffect(() => { setLocPage(1); }, [filterProviderId, filterState, filterHasStock, sortBy, searchQuery, activeTab]);
  useEffect(() => { setProvPage(1); }, [filterProviderStatus, filterProviderHasStock, providerSortBy, searchQuery, activeTab]);

  // Pagination slices
  const locTotalPages = Math.max(1, Math.ceil(filteredLocations.length / perPage));
  const provTotalPages = Math.max(1, Math.ceil(filteredProviders.length / perPage));
  const pagedLocations = useMemo(() => filteredLocations.slice((locPage - 1) * perPage, locPage * perPage), [filteredLocations, locPage, perPage]);
  const pagedProviders = useMemo(() => filteredProviders.slice((provPage - 1) * perPage, provPage * perPage), [filteredProviders, provPage, perPage]);

  const providerTableColumns: CompactTableColumn<Provider>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (p) => (
          <>
            <span className="font-medium text-app-fg">{p.name}</span>
            {isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id) ? (
              <span className="ml-2 text-micro uppercase tracking-wide text-app-fg-muted">Saving…</span>
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
        key: 'totalStock',
        header: 'Available stock',
        align: 'right',
        mobileAlign: 'left',
        hideOnMobile: true,
        render: (p) => {
          const providerLocations = displayLocations.filter((l) => l.providerId === p.id);
          const total = providerLocations.reduce((sum, l) => sum + (l.totalStock ?? 0), 0);
          return (
            <span className={`tabular-nums ${total === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted'}`}>
              {total.toLocaleString()}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => <StatusBadge status={p.status} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        mobileShowLabel: false,
        tight: true,
        nowrap: true,
        render: (p) => {
          const isOptimistic = isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id);
          if (isOptimistic) return null;
          const providerLocations = displayLocations.filter((l) => l.providerId === p.id);
          const providerTotalStock = providerLocations.reduce((sum, l) => sum + (l.totalStock ?? 0), 0);
          const actions: TableRowSheetAction[] = [
            { key: 'view', kind: 'link', label: 'View', to: `/admin/logistics/team/${p.id}?from=partners` },
            { key: 'stock', kind: 'link', label: 'Stock', to: `/admin/inventory?providerId=${p.id}` },
            { key: 'edit', kind: 'button', label: 'Edit', onClick: () => setEditingProvider(p) },
            { key: 'remove', kind: 'button', label: 'Remove', tone: 'danger', onClick: () => setDeleteProvider(p), show: providerTotalStock === 0 },
          ];
          return <TableRowActionsSheet ariaLabel={`Actions for ${p.name}`} actions={actions} />;
        },
      },
    ],
    [providerPatches, displayLocations],
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
              <span className="ml-2 text-micro uppercase tracking-wide text-app-fg-muted">Saving…</span>
            ) : null}
          </>
        ),
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
        key: 'address',
        header: 'Address',
        hideOnMobile: true,
        render: (l) => <span className="text-app-fg-muted">{l.address}</span>,
      },
      {
        key: 'state',
        header: 'State',
        render: (l) => {
          const provider = displayProviders.find((p: Provider) => p.id === l.providerId);
          const state = detectState(l, provider?.coverageArea);
          return state
            ? <span className="text-app-fg-muted">{state}</span>
            : <span className="text-app-fg-muted">—</span>;
        },
      },
      {
        key: 'totalStock',
        header: 'Available stock',
        align: 'right',
        mobileAlign: 'left',
        hideOnMobile: true,
        render: (l) => (
          <span className={`tabular-nums ${(l.totalStock ?? 0) === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted'}`}>
            {(l.totalStock ?? 0).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'lowStock',
        header: 'Alert threshold',
        align: 'right',
        mobileAlign: 'left',
        hideOnMobile: true,
        render: (l) => {
          const hasOverride = l.lowStockThreshold != null;
          const effective = hasOverride ? (l.lowStockThreshold as number) : globalLowStockThreshold;
          return (
            <span className="tabular-nums text-app-fg-muted">
              {effective} units{!hasOverride ? ' · global' : ''}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (l) => <StatusBadge status={l.status} />,
      },
      {
        key: 'whatsapp',
        header: 'WhatsApp',
        mobileLabel: 'WhatsApp',
        tight: true,
        render: (l) =>
          l.whatsappGroupLink ? (
            <a
              href={l.whatsappGroupLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-success-600 dark:text-success-400 hover:underline text-xs font-medium"
              title={l.whatsappGroupLink}
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Linked
            </a>
          ) : (
            <span className="text-xs text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        mobileShowLabel: false,
        tight: true,
        nowrap: true,
        render: (l) => {
          const isOptimistic = isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id);
          if (isOptimistic) return null;
          const hasStock = (l.totalStock ?? 0) > 0;
          const actions: TableRowSheetAction[] = [
            { key: 'view', kind: 'button', label: 'View', onClick: () => setViewingLocation(l) },
            { key: 'stock', kind: 'link', label: 'Stock', to: `/admin/inventory?locationId=${l.id}` },
            { key: 'edit', kind: 'button', label: 'Edit', onClick: () => setEditingLocation(l) },
            { key: 'remove', kind: 'button', label: 'Remove', tone: 'danger', onClick: () => setDeleteLocation(l), show: !hasStock },
          ];
          return <TableRowActionsSheet ariaLabel={`Actions for ${l.name}`} actions={actions} />;
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
            sheetTitle="Actions"
            triggerAriaLabel="Logistics toolbar"
            saveFilterKey
            filtersBadgeCount={
              activeTab === 'locations'
                ? (filterProviderId ? 1 : 0) + (filterState ? 1 : 0) + (filterHasStock ? 1 : 0)
                : (filterProviderStatus ? 1 : 0) + (filterProviderHasStock ? 1 : 0)
            }
            filters={(() => {
              const fBox = 'relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
              const fSel = '!bg-transparent !border-transparent !text-center';
              return activeTab === 'locations' ? (
                <>
                  <div className={fBox}><SearchableSelect value={filterProviderId} onChange={(v) => setFilterProviderId(v)} placeholder="All companies" options={[{ value: '', label: 'All companies' }, ...displayProviders.map((p) => ({ value: p.id, label: p.name }))]} searchPlaceholder="Search companies..." wrapperClassName="w-full" triggerClassName={fSel} inlineChevron /></div>
                  <div className={fBox}><SearchableSelect value={filterState} onChange={(v) => setFilterState(v)} placeholder="All states" options={[{ value: '', label: 'All states' }, ...availableStates.map((s) => ({ value: s, label: s }))]} searchPlaceholder="Search states..." wrapperClassName="w-full" triggerClassName={fSel} inlineChevron /></div>
                  <div className={fBox}><FormSelect value={filterHasStock} onChange={(e) => setFilterHasStock(e.target.value)} options={[{ value: '', label: 'All stock levels' }, { value: 'has_stock', label: 'Has stock' }, { value: 'no_stock', label: 'No stock' }]} wrapperClassName="w-full" className={fSel} inlineChevron /></div>
                  <div className={fBox}><FormSelect value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} options={[{ value: 'name', label: 'Sort: Name' }, { value: 'stock-desc', label: 'Sort: Stock (high)' }, { value: 'stock-asc', label: 'Sort: Stock (low)' }, { value: 'provider', label: 'Sort: Company' }]} wrapperClassName="w-full" className={fSel} inlineChevron /></div>
                </>
              ) : (
                <>
                  <div className={fBox}><FormSelect value={filterProviderStatus} onChange={(e) => setFilterProviderStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} wrapperClassName="w-full" className={fSel} inlineChevron /></div>
                  <div className={fBox}><FormSelect value={filterProviderHasStock} onChange={(e) => setFilterProviderHasStock(e.target.value)} options={[{ value: '', label: 'All stock levels' }, { value: 'has_stock', label: 'Has stock' }, { value: 'no_stock', label: 'No stock' }]} wrapperClassName="w-full" className={fSel} inlineChevron /></div>
                  <div className={fBox}><FormSelect value={providerSortBy} onChange={(e) => setProviderSortBy(e.target.value as typeof providerSortBy)} options={[{ value: 'name', label: 'Sort: Name' }, { value: 'status', label: 'Sort: Status' }, { value: 'stock-desc', label: 'Sort: Stock (high)' }, { value: 'stock-asc', label: 'Sort: Stock (low)' }]} wrapperClassName="w-full" className={fSel} inlineChevron /></div>
                </>
              );
            })()}
            desktop={
              <div className="flex flex-wrap gap-2">
                <PageRefreshButton />
                <Button variant="secondary" size="sm" onClick={() => setShowAddProvider(true)}>
                  + Company
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setAddLocationProviderId(''); setShowAddLocation(true); }}>
                  + Location
                </Button>
                <Link to="/admin/logistics/partners/import-combined" prefetch="intent" className="btn-primary btn-sm">
                  Import from Excel
                </Link>
                <Button variant="secondary" size="sm" onClick={() => setShowExport(true)}>
                  Generate report
                </Button>
              </div>
            }
            sheet={
              <>
                <Button variant="secondary" className="h-12 w-full justify-center" onClick={() => setShowAddProvider(true)}>
                  + Company
                </Button>
                <Button variant="secondary" className="h-12 w-full justify-center" onClick={() => { setAddLocationProviderId(''); setShowAddLocation(true); }}>
                  + Location
                </Button>
                <Link to="/admin/logistics/partners/import-combined" prefetch="intent" className="btn-secondary h-12 w-full justify-center text-center">
                  Import from Excel
                </Link>
                <Button variant="secondary" className="h-12 w-full justify-center" onClick={() => setShowExport(true)}>
                  Generate report
                </Button>
              </>
            }
          />
        }
      />

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        config={activeTab === 'locations' ? EXPORT_CONFIGS.logistics_locations : EXPORT_CONFIGS.logistics_partners}
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
        mobileGrid
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
                hint="Used by the Sales Share to logistics company flow. Optional."
                wrapperClassName="sm:col-span-2"
              />
              <TextInput
                id="add-location-low-stock"
                name="lowStockThreshold"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                label="Low-stock alert (units)"
                placeholder="e.g. 25"
                hint="Optional. Leave empty to inherit the org-wide default."
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
                <dt className="text-xs font-medium text-app-fg-muted">Low-stock alert</dt>
                <dd className="mt-0.5 text-sm text-app-fg tabular-nums">
                  {viewingLocation.lowStockThreshold != null
                    ? `${viewingLocation.lowStockThreshold} units`
                    : `${globalLowStockThreshold} units`}
                  {viewingLocation.lowStockThreshold == null && (
                    <span className="text-app-fg-muted"> · inherited from org-wide default</span>
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
            {(viewingLocation.totalStock ?? 0) === 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteLocation(viewingLocation);
                  setViewingLocation(null);
                }}
              >
                Remove
              </Button>
            )}
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
                hint="Leave empty to remove. Used by the Sales Share to logistics company flow."
                wrapperClassName="sm:col-span-2"
              />
              <TextInput
                id="edit-location-low-stock"
                name="lowStockThreshold"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                label="Low-stock alert (units)"
                defaultValue={editingLocation.lowStockThreshold ?? ''}
                placeholder="Inherits global"
                hint="Leave empty to inherit the org-wide default."
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
          <div className="flex flex-wrap gap-2 px-6 py-4 border-t border-app-border">
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
            {displayLocations.filter((l) => l.providerId === viewingProvider.id).reduce((sum, l) => sum + (l.totalStock ?? 0), 0) === 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteProvider(viewingProvider);
                  setViewingProvider(null);
                }}
              >
                Remove
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewingProvider(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => {
          setActiveTab(v as typeof activeTab);
          setSearch('');
        }}
        tabs={[
          { value: 'locations', label: `Locations (${filteredLocations.length !== displayTotalLocations ? `${filteredLocations.length}/` : ''}${displayTotalLocations})` },
          { value: 'providers', label: `Companies (${filteredProviders.length !== displayTotalProviders ? `${filteredProviders.length}/` : ''}${displayTotalProviders})` },
        ]}
      />

      <ToolbarFiltersCollapsible
        hideMobileSheet
        badgeCount={
          activeTab === 'locations'
            ? (filterProviderId ? 1 : 0) + (filterState ? 1 : 0) + (filterHasStock ? 1 : 0)
            : (filterProviderStatus ? 1 : 0) + (filterProviderHasStock ? 1 : 0)
        }
        onClearAll={
          activeTab === 'locations'
            ? () => { setFilterProviderId(''); setFilterState(''); setFilterHasStock(''); }
            : () => { setFilterProviderStatus(''); setFilterProviderHasStock(''); }
        }
        searchRow={
          <SearchInput
            value={search}
            onChange={setSearch}
            clearable
            withSubmitButton
            placeholder={
              activeTab === 'providers'
                ? 'Search by name, contact, or coverage…'
                : 'Search by name, address, or company…'
            }
            wrapperClassName="w-full min-w-0 flex-1"
          />
        }
        desktopInlineFilters={
          activeTab === 'locations' ? (
            <>
              <SearchableSelect
                value={filterProviderId}
                onChange={(v) => setFilterProviderId(v)}
                placeholder="All companies"
                options={[
                  { value: '', label: 'All companies' },
                  ...displayProviders.map((p) => ({ value: p.id, label: p.name })),
                ]}
                searchPlaceholder="Search companies..."
                wrapperClassName="w-40 sm:w-48"
              />
              <SearchableSelect
                value={filterState}
                onChange={(v) => setFilterState(v)}
                placeholder="All states"
                options={[
                  { value: '', label: 'All states' },
                  ...availableStates.map((s) => ({ value: s, label: s })),
                ]}
                searchPlaceholder="Search states..."
                wrapperClassName="w-36 sm:w-44"
              />
              <FormSelect
                value={filterHasStock}
                onChange={(e) => setFilterHasStock(e.target.value)}
                options={[
                  { value: '', label: 'All stock levels' },
                  { value: 'has_stock', label: 'Has stock' },
                  { value: 'no_stock', label: 'No stock' },
                ]}
                wrapperClassName="w-36 sm:w-40"
              />
              <FormSelect
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                options={[
                  { value: 'name', label: 'Sort: Name' },
                  { value: 'stock-desc', label: 'Sort: Stock (high)' },
                  { value: 'stock-asc', label: 'Sort: Stock (low)' },
                  { value: 'provider', label: 'Sort: Company' },
                ]}
                wrapperClassName="w-36 sm:w-44"
              />
            </>
          ) : (
            <>
              <FormSelect
                value={filterProviderStatus}
                onChange={(e) => setFilterProviderStatus(e.target.value)}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
                wrapperClassName="w-36 sm:w-40"
              />
              <FormSelect
                value={filterProviderHasStock}
                onChange={(e) => setFilterProviderHasStock(e.target.value)}
                options={[
                  { value: '', label: 'All stock levels' },
                  { value: 'has_stock', label: 'Has stock' },
                  { value: 'no_stock', label: 'No stock' },
                ]}
                wrapperClassName="w-36 sm:w-44"
              />
              <FormSelect
                value={providerSortBy}
                onChange={(e) => setProviderSortBy(e.target.value as typeof providerSortBy)}
                options={[
                  { value: 'name', label: 'Sort: Name' },
                  { value: 'status', label: 'Sort: Status' },
                  { value: 'stock-desc', label: 'Sort: Stock (high)' },
                  { value: 'stock-asc', label: 'Sort: Stock (low)' },
                ]}
                wrapperClassName="w-36 sm:w-44"
              />
            </>
          )
        }
        sheetFilterBody={
          activeTab === 'locations' ? (
            <div className="flex flex-col gap-3">
              <SearchableSelect
                value={filterProviderId}
                onChange={(v) => setFilterProviderId(v)}
                placeholder="All companies"
                options={[
                  { value: '', label: 'All companies' },
                  ...displayProviders.map((p) => ({ value: p.id, label: p.name })),
                ]}
                searchPlaceholder="Search companies..."
                wrapperClassName="w-full"
              />
              <SearchableSelect
                value={filterState}
                onChange={(v) => setFilterState(v)}
                placeholder="All states"
                options={[
                  { value: '', label: 'All states' },
                  ...availableStates.map((s) => ({ value: s, label: s })),
                ]}
                searchPlaceholder="Search states..."
                wrapperClassName="w-full"
              />
              <FormSelect
                value={filterHasStock}
                onChange={(e) => setFilterHasStock(e.target.value)}
                options={[
                  { value: '', label: 'All stock levels' },
                  { value: 'has_stock', label: 'Has stock' },
                  { value: 'no_stock', label: 'No stock' },
                ]}
                wrapperClassName="w-full"
              />
              <FormSelect
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                options={[
                  { value: 'name', label: 'Sort: Name' },
                  { value: 'stock-desc', label: 'Sort: Stock (high)' },
                  { value: 'stock-asc', label: 'Sort: Stock (low)' },
                  { value: 'provider', label: 'Sort: Company' },
                ]}
                wrapperClassName="w-full"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <FormSelect
                value={filterProviderStatus}
                onChange={(e) => setFilterProviderStatus(e.target.value)}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
                wrapperClassName="w-full"
              />
              <FormSelect
                value={filterProviderHasStock}
                onChange={(e) => setFilterProviderHasStock(e.target.value)}
                options={[
                  { value: '', label: 'All stock levels' },
                  { value: 'has_stock', label: 'Has stock' },
                  { value: 'no_stock', label: 'No stock' },
                ]}
                wrapperClassName="w-full"
              />
              <FormSelect
                value={providerSortBy}
                onChange={(e) => setProviderSortBy(e.target.value as typeof providerSortBy)}
                options={[
                  { value: 'name', label: 'Sort: Name' },
                  { value: 'status', label: 'Sort: Status' },
                  { value: 'stock-desc', label: 'Sort: Stock (high)' },
                  { value: 'stock-asc', label: 'Sort: Stock (low)' },
                ]}
                wrapperClassName="w-full"
              />
            </div>
          )
        }
      />

      {/* Content */}
      {activeTab === 'providers' && (
        <>
          <CompactTable<Provider>
            columns={providerTableColumns}
            rows={pagedProviders}
            rowKey={(p) => p.id}
            rowClassName={(p) =>
              isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id) ? 'opacity-60' : ''
            }
            emptyTitle={searchQuery || filterProviderStatus || filterProviderHasStock ? 'No companies match your filters' : 'No logistics companies yet'}
            emptyDescription={searchQuery || filterProviderStatus || filterProviderHasStock ? 'Try adjusting your search or filters.' : undefined}
            renderMobileCard={(p) => {
              const isOptimistic = isOptimisticId(p.id) || isOptimisticPatched(providerPatches, p.id);
              const pLocs = displayLocations.filter((l) => l.providerId === p.id);
              const pStock = pLocs.reduce((sum, l) => sum + (l.totalStock ?? 0), 0);
              return (
                <div className="space-y-2">
                  <Link
                    to={`/admin/logistics/team/${p.id}?from=partners`}
                    prefetch="intent"
                    className="-mx-3 -mt-2.5 block w-[calc(100%+1.5rem)] px-3 pt-2.5 pb-1 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-app-fg truncate">{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-app-fg-muted truncate">
                      <span>{p.coverageArea ?? '—'}</span>
                      <span className={`tabular-nums font-medium ${pStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                        {pStock.toLocaleString()} units
                      </span>
                    </div>
                  </Link>
                  {!isOptimistic && (
                    <div className="flex items-center gap-2 border-t border-app-border pt-2 -mx-3 px-3 -mb-0.5">
                      <button type="button" className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => { e.stopPropagation(); setEditingProvider(p); }}>
                        Edit
                      </button>
                      <Link to={`/admin/inventory?providerId=${p.id}`} prefetch="intent" className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => e.stopPropagation()}>
                        Stock
                      </Link>
                      {pStock === 0 && (
                        <button type="button" className="text-xs font-medium text-danger-600 dark:text-danger-400" onClick={(e) => { e.stopPropagation(); setDeleteProvider(p); }}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Pagination
            page={provPage}
            totalPages={provTotalPages}
            onPageChange={setProvPage}
            pageSizeOptions={[25, 50, 100, 200]}
            pageSize={perPage}
            onPageSizeChange={(s) => { setPerPage(s); setProvPage(1); }}
            showWhenSinglePage
          />
        </>
      )}

      {activeTab === 'locations' && (
        <>
          <CompactTable<Location>
            columns={locationTableColumns}
            rows={pagedLocations}
            rowKey={(l) => l.id}
            rowClassName={(l) =>
              isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id) ? 'opacity-60' : ''
            }
            emptyTitle={
              searchQuery || filterProviderId || filterState || filterHasStock
                ? 'No locations match your filters'
                : 'No locations yet'
            }
            emptyDescription={
              searchQuery || filterProviderId || filterState || filterHasStock
                ? 'Try adjusting your search, company, state, or stock filter.'
                : 'Add a logistics company first, then add locations.'
            }
            renderMobileCard={(l) => {
              const isOptimistic = isOptimisticId(l.id) || isOptimisticPatched(locationPatches, l.id);
              const stockCount = l.totalStock ?? 0;
              return (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => !isOptimistic && setViewingLocation(l)}
                    className="-mx-3 -mt-2.5 block w-[calc(100%+1.5rem)] px-3 pt-2.5 pb-1 space-y-1.5 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-app-fg truncate">{l.name}</span>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-app-fg-muted truncate">
                      <span>{l.providerName ?? 'Unknown company'}</span>
                      <span className={`tabular-nums font-medium ${stockCount === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                        {stockCount.toLocaleString()} units
                      </span>
                    </div>
                    {l.address ? (
                      <p className="text-xs text-app-fg-muted truncate">{l.address}</p>
                    ) : null}
                  </button>
                  {!isOptimistic && (
                    <div className="flex items-center gap-2 border-t border-app-border pt-2 -mx-3 px-3 -mb-0.5">
                      <Link to={`/admin/inventory?locationId=${l.id}`} className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => e.stopPropagation()}>
                        Stock
                      </Link>
                      <button type="button" className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => { e.stopPropagation(); setEditingLocation(l); }}>
                        Edit
                      </button>
                      {stockCount === 0 && (
                        <button type="button" className="text-xs font-medium text-danger-600 dark:text-danger-400" onClick={(e) => { e.stopPropagation(); setDeleteLocation(l); }}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Pagination
            page={locPage}
            totalPages={locTotalPages}
            onPageChange={setLocPage}
            pageSizeOptions={[25, 50, 100, 200]}
            pageSize={perPage}
            onPageSizeChange={(s) => { setPerPage(s); setLocPage(1); }}
            showWhenSinglePage
          />
        </>
      )}

      <ConfirmActionModal
        open={!!deleteProvider}
        onClose={() => { if (!deleteSubmitting) setDeleteProvider(null); }}
        title="Remove logistics company?"
        description={
          deleteProvider
            ? `"${deleteProvider.name}" and all its locations will be archived. Historical data (orders, transfers, audit trail) is preserved.`
            : ''
        }
        confirmLabel="Remove company"
        cancelLabel="Keep"
        variant="danger"
        loading={deleteSubmitting}
        onConfirm={() => {
          if (!deleteProvider) return;
          const fd = new FormData();
          fd.set('intent', 'deleteProvider');
          fd.set('providerId', deleteProvider.id);
          deleteFetcher.submit(fd, { method: 'POST' });
        }}
        error={(deleteFetcher.data as { error?: string } | undefined)?.error ?? null}
      />

      <ConfirmActionModal
        open={!!deleteLocation}
        onClose={() => { if (!deleteSubmitting) setDeleteLocation(null); }}
        title="Remove location?"
        description={
          deleteLocation
            ? `"${deleteLocation.name}" will be archived. Historical data (orders, transfers, stock movements) is preserved.`
            : ''
        }
        confirmLabel="Remove location"
        cancelLabel="Keep"
        variant="danger"
        loading={deleteSubmitting}
        onConfirm={() => {
          if (!deleteLocation) return;
          const fd = new FormData();
          fd.set('intent', 'deleteLocation');
          fd.set('locationId', deleteLocation.id);
          deleteFetcher.submit(fd, { method: 'POST' });
        }}
        error={(deleteFetcher.data as { error?: string } | undefined)?.error ?? null}
      />
    </div>
  );
}
