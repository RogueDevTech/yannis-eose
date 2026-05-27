import { useMemo, useState } from 'react';
import { Form, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import {
  useOptimisticListPatches,
  applyOptimisticPatches,
  isOptimisticPatched,
} from '~/hooks/useOptimisticListPatches';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardFooter, StatCard } from '~/components/ui/card';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormField } from '~/components/ui/form-field';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import { useFetcherToast } from '~/components/ui/toast';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ClearFiltersButton } from '~/components/ui/clear-filters-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SortMenu } from '~/components/ui/sort-menu';
import { StatusBadge } from '~/components/ui/status-badge';

export interface WarehouseStockSummary {
  totalStock: number;
  totalReserved: number;
  skuCount: number;
}

export interface WarehouseRow {
  id: string;
  name: string;
  address: string;
  coordinates: string | null;
  dispatchLocked: boolean;
  status: string;
  createdAt: string;
  providerKind: 'WAREHOUSE' | 'THIRD_PARTY';
  providerName: string;
  stockSummary: WarehouseStockSummary;
}

export interface WarehousesPageProps {
  warehouses: WarehouseRow[];
  totalWarehouses: number;
  page: number;
  limit: number;
  totalPages: number;
  search: string;
  sortBy?: 'createdAt' | 'name' | 'available';
  sortDir?: 'asc' | 'desc';
  canManage: boolean;
  overview: {
    activeWarehousesCount: number;
    warehousesWithAvailableStockCount: number;
    dispatchLockedCount: number;
    totalUnits: number;
    totalReserved: number;
    totalAvailable: number;
    skuCount: number;
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { dateStyle: 'medium' });
}

export function WarehousesPage({
  warehouses,
  totalWarehouses,
  page,
  limit,
  totalPages,
  search,
  sortBy = 'createdAt',
  sortDir = 'desc',
  canManage,
  overview,
}: WarehousesPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const isRefetching = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState('');

  // Edit modal — `editTarget` is the warehouse row being edited (null = closed).
  const [editTarget, setEditTarget] = useState<WarehouseRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCoordinates, setEditCoordinates] = useState('');

  useFetcherToast(fetcher.data, {
    successMessage: 'Warehouse saved',
    skipErrorToast: showCreate || editTarget !== null,
  });

  const isCreating =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'createWarehouse';
  const isUpdating =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'updateWarehouse';

  useCloseOnFetcherSuccess(fetcher, () => {
    setShowCreate(false);
    setName('');
    setAddress('');
    setCoordinates('');
    setEditTarget(null);
  });

  const optimisticWarehouses = useOptimisticListMerge<WarehouseRow>(fetcher, (fd, intent) => {
    if (intent !== 'createWarehouse') return null;
    const draftName = fd.get('name')?.toString().trim();
    const draftAddress = fd.get('address')?.toString().trim();
    if (!draftName || !draftAddress) return null;
    return [
      {
        id: optimisticId('warehouse'),
        name: draftName,
        address: draftAddress,
        coordinates: fd.get('coordinates')?.toString().trim() || null,
        dispatchLocked: false,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        stockSummary: { totalStock: 0, totalReserved: 0, skuCount: 0 },
        providerKind: 'WAREHOUSE',
        providerName: 'Inhouse',
      },
    ];
  });

  const warehousePatches = useOptimisticListPatches<WarehouseRow>(fetcher, (fd, intent) => {
    if (intent !== 'updateWarehouse') return null;
    const id = fd.get('warehouseId')?.toString();
    if (!id) return null;
    const draftName = fd.get('name')?.toString().trim();
    const draftAddress = fd.get('address')?.toString().trim();
    if (!draftName || !draftAddress) return null;
    return [
      {
        id,
        patch: {
          name: draftName,
          address: draftAddress,
          coordinates: fd.get('coordinates')?.toString().trim() || null,
        },
      },
    ];
  });

  const display = applyOptimisticPatches(
    [...optimisticWarehouses, ...warehouses],
    warehousePatches,
  );
  // Preview modal for mobile cards — shows details + all action buttons.
  const [previewWarehouse, setPreviewWarehouse] = useState<WarehouseRow | null>(null);

  const ready = name.trim().length >= 2 && address.trim().length >= 2;
  const editReady =
    editName.trim().length >= 2 && editAddress.trim().length >= 2;

  const submit = () => {
    if (!ready) return;
    const fd = new FormData();
    fd.set('intent', 'createWarehouse');
    fd.set('name', name.trim());
    fd.set('address', address.trim());
    fd.set('coordinates', coordinates.trim());
    fetcher.submit(fd, { method: 'post', action: '/admin/inventory/warehouses' });
  };

  const openEdit = (w: WarehouseRow) => {
    setEditTarget(w);
    setEditName(w.name);
    setEditAddress(w.address);
    setEditCoordinates(w.coordinates ?? '');
  };

  const submitEdit = () => {
    if (!editTarget || !editReady) return;
    const fd = new FormData();
    fd.set('intent', 'updateWarehouse');
    fd.set('warehouseId', editTarget.id);
    fd.set('name', editName.trim());
    fd.set('address', editAddress.trim());
    fd.set('coordinates', editCoordinates.trim());
    fetcher.submit(fd, { method: 'post', action: '/admin/inventory/warehouses' });
  };

  const columns: CompactTableColumn<WarehouseRow>[] = [
    {
      key: 'name',
      header: 'Site',
      render: (w) => (
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-app-fg truncate">{w.name}</span>
          {w.coordinates ? (
            <span className="text-xs text-app-fg-muted truncate">{w.coordinates}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      render: (w) => (
        <span className="text-sm text-app-fg-muted whitespace-pre-wrap max-w-md">{w.address}</span>
      ),
    },
    {
      key: 'skus',
      header: 'SKUs',
      nowrap: true,
      render: (w) => (
        <span className="tabular-nums text-sm text-app-fg">{w.stockSummary.skuCount}</span>
      ),
    },
    {
      key: 'units',
      header: 'Total units',
      nowrap: true,
      render: (w) => (
        <span className="tabular-nums text-sm text-app-fg">{w.stockSummary.totalStock}</span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      nowrap: true,
      render: (w) => {
        const available = Math.max(0, w.stockSummary.totalStock - w.stockSummary.totalReserved);
        const tone =
          available === 0
            ? 'text-danger-600 dark:text-danger-400'
            : 'text-success-600 dark:text-success-400';
        return <span className={`tabular-nums text-sm ${tone}`}>{available}</span>;
      },
    },
    {
      key: 'created',
      header: 'Created',
      nowrap: true,
      render: (w) => (
        <span className="text-sm text-app-fg-muted">{formatDate(w.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: (w) =>
        isOptimisticId(w.id) ? (
          <div className="inline-flex items-center justify-end gap-1.5">
            <TableActionButton inert variant="primary">
              View stock
            </TableActionButton>
          </div>
        ) : (
          <div className="inline-flex items-center justify-end gap-1.5">
            {canManage ? (
              <TableActionButton
                variant="neutral"
                onClick={() => openEdit(w)}
                disabled={isOptimisticPatched(warehousePatches, w.id)}
              >
                Edit
              </TableActionButton>
            ) : null}
            <TableActionButton to={`/admin/inventory?locationId=${w.id}`} variant="primary">
              View stock
            </TableActionButton>
          </div>
        ),
    },
  ];

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (searchParams.get('search')) n += 1;
    const sb = searchParams.get('sortBy');
    const sd = searchParams.get('sortDir');
    if ((sb && sb !== 'createdAt') || (sd && sd !== 'desc')) n += 1;
    return n;
  }, [searchParams]);

  const updateWarehouseSort = (nextSortBy: 'createdAt' | 'name' | 'available', nextSortDir: 'asc' | 'desc') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const isDefault = nextSortBy === 'createdAt' && nextSortDir === 'desc';
      if (isDefault) {
        next.delete('sortBy');
        next.delete('sortDir');
      } else {
        next.set('sortBy', nextSortBy);
        next.set('sortDir', nextSortDir);
      }
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const toolbar = useMemo(() => {
    const sortIsDefault = sortBy === 'createdAt' && sortDir === 'desc';
    return (
      <ToolbarFiltersCollapsible
        searchRow={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <Form method="get" replace className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                name="search"
                defaultValue={search}
                placeholder="Search by warehouse name…"
                className="sm:max-w-xs"
                aria-label="Search warehouses"
                withSubmitButton
                wrapperClassName="w-full sm:max-w-xs"
              />
              <input type="hidden" name="page" value="1" />
            </Form>
            <div className="hidden md:inline-flex">
              <SortMenu
                value={{ sortBy, sortDir }}
                onChange={(next) =>
                  updateWarehouseSort(
                    next.sortBy as 'createdAt' | 'name' | 'available',
                    next.sortDir,
                  )
                }
                defaultValue={{ sortBy: 'createdAt', sortDir: 'desc' }}
                options={[
                  {
                    value: 'createdAt',
                    label: 'Recently added',
                    description: 'When the warehouse was created.',
                    ascLabel: 'Oldest first',
                    descLabel: 'Newest first',
                    defaultDir: 'desc',
                  },
                  {
                    value: 'name',
                    label: 'Name',
                    description: 'Alphabetical.',
                    ascLabel: 'A → Z',
                    descLabel: 'Z → A',
                    defaultDir: 'asc',
                  },
                  {
                    value: 'available',
                    label: 'Available units',
                    description: 'Stock count minus reserved units across the warehouse.',
                    ascLabel: 'Lowest first',
                    descLabel: 'Highest first',
                    defaultDir: 'desc',
                  },
                ]}
              />
            </div>
          </div>
        }
        desktopInlineFilters={<div />}
        hideMobileSheet
        sheetFilterBody={null}
        badgeCount={sortIsDefault ? 0 : 1}
        sheetTitle="Filters"
        sheetSubtitle="Search warehouses by name."
      />
    );
  }, [search, sortBy, sortDir, setSearchParams]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Our warehouses"
        description="Company sites used for intake, adjustments, and inbound shipments."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Warehouse tools"
            sheetSubtitle={<span>Sort, search, and manage</span>}
            triggerAriaLabel="Warehouse toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                {canManage ? (
                  <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                    Add warehouse
                  </Button>
                ) : null}
              </div>
            }
            sheet={({ closeSheet }) => (
              <>
                <SortMenu
                  value={{ sortBy, sortDir }}
                  onChange={(next) => {
                    updateWarehouseSort(
                      next.sortBy as 'createdAt' | 'name' | 'available',
                      next.sortDir,
                    );
                    closeSheet();
                  }}
                  defaultValue={{ sortBy: 'createdAt', sortDir: 'desc' }}
                  options={[
                    { value: 'createdAt', label: 'Recently added', ascLabel: 'Oldest first', descLabel: 'Newest first', defaultDir: 'desc' },
                    { value: 'name', label: 'Name', ascLabel: 'A → Z', descLabel: 'Z → A', defaultDir: 'asc' },
                    { value: 'available', label: 'Available units', ascLabel: 'Lowest first', descLabel: 'Highest first', defaultDir: 'desc' },
                  ]}
                />
                {canManage ? (
                  <Button variant="primary" size="sm" className="w-full justify-center" onClick={() => { closeSheet(); setShowCreate(true); }}>
                    Add warehouse
                  </Button>
                ) : null}
              </>
            )}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          {
            label: 'Active warehouses',
            value: overview.activeWarehousesCount,
            title: 'Company-owned warehouse sites (ACTIVE)',
            valueClassName: 'text-brand-600 dark:text-brand-400',
          },
          {
            label: 'Warehouses with stock available',
            value: overview.warehousesWithAvailableStockCount,
            title: 'Warehouses where available units > 0',
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Dispatch locked',
            value: overview.dispatchLockedCount,
            title: 'Warehouses blocked by reconciliation lock',
            valueClassName:
              overview.dispatchLockedCount > 0
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-app-fg-muted',
          },
          {
            label: 'Total available units',
            value: overview.totalAvailable,
            title: `${overview.skuCount} SKU${overview.skuCount === 1 ? '' : 's'} · ${overview.totalReserved} reserved`,
            valueClassName:
              overview.totalAvailable === 0
                ? 'text-danger-600 dark:text-danger-400'
                : 'text-info-600 dark:text-info-400',
          },
        ]}
      />

      {/* Card chrome hidden on mobile — listing goes edge-to-edge. Desktop keeps the card wrapper. */}
      <div className="md:card md:p-4">
        <div className="mb-4">{toolbar}</div>
        <ClearFiltersButton count={activeFilterCount} preserve={['perPage']} className="mt-2 px-4" />
        <div>
          <TableLoadingOverlay show={isRefetching} minHeightClassName={display.length === 0 ? 'min-h-[14rem]' : 'min-h-[12rem]'}>
            {display.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  variant="card"
                  title={search ? 'No warehouses match your search' : 'No warehouses yet'}
                  description={
                    search
                      ? 'Try a different name or clear the search filter.'
                      : canManage
                        ? 'Add a company-owned warehouse here. Partner logistics sites are managed under Logistics → Partners; stock levels for any site appear on Inventory.'
                        : 'Partner logistics sites are managed under Logistics → Partners. Stock at any location appears on Inventory.'
                  }
                  action={
                    !search && canManage ? (
                      <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                        Add warehouse
                      </Button>
                    ) : !search ? (
                      <div className="flex flex-wrap gap-3">
                        <Link
                          to="/admin/inventory"
                          className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          Open Inventory
                        </Link>
                        <Link
                          to="/admin/logistics/partners"
                          className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          Logistics partners
                        </Link>
                      </div>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <CompactTable<WarehouseRow>
                columns={columns}
                rows={display}
                rowKey={(r) => r.id}
                rowClassName={(w) =>
                  isOptimisticId(w.id) || isOptimisticPatched(warehousePatches, w.id)
                    ? 'opacity-60'
                    : ''
                }
                emptyTitle="No warehouses match your filter"
                renderMobileCard={(w) => {
                  const available = Math.max(0, w.stockSummary.totalStock - w.stockSummary.totalReserved);
                  const availableTone =
                    available === 0
                      ? 'text-danger-600 dark:text-danger-400'
                      : 'text-success-600 dark:text-success-400';
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-app-fg truncate">{w.name}</span>
                        <StatusBadge status={w.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums">
                        <span>{w.stockSummary.skuCount} SKUs</span>
                        <span>{w.stockSummary.totalStock} units</span>
                        <span className={availableTone}>{available} avail</span>
                      </div>
                      {w.address ? (
                        <p className="text-xs text-app-fg-muted truncate">{w.address}</p>
                      ) : null}
                    </>
                  );
                  if (isOptimisticId(w.id)) return body;
                  return (
                    <button
                      type="button"
                      onClick={() => setPreviewWarehouse(w)}
                      className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                    >
                      {body}
                    </button>
                  );
                }}
              />
            )}
          </TableLoadingOverlay>
        </div>

        {totalPages > 1 ? (
          <div className="border-t border-app-border pt-4 mt-0 md:px-0 px-1">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-app-fg-muted">
                {totalWarehouses > 0
                  ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, totalWarehouses)} of ${totalWarehouses} warehouses`
                  : 'No warehouses'}
              </p>
              <Pagination page={page} totalPages={totalPages} pageSize={limit} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Preview modal — mobile card tap */}
      {previewWarehouse && (
        <Modal
          open
          onClose={() => setPreviewWarehouse(null)}
          maxWidth="max-w-md"
          aria-labelledby="preview-warehouse-title"
        >
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 id="preview-warehouse-title" className="text-base font-semibold text-app-fg truncate">
                {previewWarehouse.name}
              </h3>
              <StatusBadge status={previewWarehouse.status} />
            </div>
            <dl className="space-y-2 text-sm">
              {previewWarehouse.address ? (
                <div>
                  <dt className="text-xs font-medium text-app-fg-muted">Address</dt>
                  <dd className="mt-0.5 text-app-fg">{previewWarehouse.address}</dd>
                </div>
              ) : null}
              {previewWarehouse.coordinates ? (
                <div>
                  <dt className="text-xs font-medium text-app-fg-muted">Coordinates</dt>
                  <dd className="mt-0.5 text-app-fg">{previewWarehouse.coordinates}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">SKU count</dt>
                <dd className="mt-0.5 text-app-fg tabular-nums">{previewWarehouse.stockSummary.skuCount}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Total units</dt>
                <dd className="mt-0.5 text-app-fg tabular-nums">{previewWarehouse.stockSummary.totalStock}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Available</dt>
                <dd className={`mt-0.5 tabular-nums ${
                  Math.max(0, previewWarehouse.stockSummary.totalStock - previewWarehouse.stockSummary.totalReserved) === 0
                    ? 'text-danger-600 dark:text-danger-400'
                    : 'text-success-600 dark:text-success-400'
                }`}>
                  {Math.max(0, previewWarehouse.stockSummary.totalStock - previewWarehouse.stockSummary.totalReserved)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-app-fg-muted">Created</dt>
                <dd className="mt-0.5 text-app-fg-muted">{formatDate(previewWarehouse.createdAt)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-app-border">
              {canManage ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    openEdit(previewWarehouse);
                    setPreviewWarehouse(null);
                  }}
                >
                  Edit
                </Button>
              ) : null}
              <Link
                to={`/admin/inventory?locationId=${previewWarehouse.id}`}
                className="btn-primary btn-sm"
              >
                View stock
              </Link>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewWarehouse(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        open={showCreate}
        onClose={() => {
          if (isCreating) return;
          setShowCreate(false);
        }}
        aria-labelledby="create-warehouse-title"
      >
        <div className="space-y-3 p-5">
          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('createWarehouse')} />
          <h3 id="create-warehouse-title" className="text-base font-semibold text-app-fg">
            Add warehouse
          </h3>
          <p className="text-sm text-app-fg-muted">
            Adds a company-owned warehouse. It becomes available for inbound shipments (receive → verify),
            adjustments, and allocations.
          </p>
          <FormField label="Name" hint="e.g. Lagos main warehouse">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              autoFocus
            />
          </FormField>
          <FormField label="Address" hint="Street, area, city, state">
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </FormField>
          <FormField label="Coordinates" hint="Optional — lat,lng">
            <TextInput
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              maxLength={100}
              placeholder="6.5244, 3.3792"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreate(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isCreating}
              disabled={!ready}
              onClick={submit}
            >
              Add warehouse
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        onClose={() => {
          if (isUpdating) return;
          setEditTarget(null);
        }}
        aria-labelledby="edit-warehouse-title"
      >
        <div className="space-y-3 p-5">
          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('updateWarehouse')} />
          <h3 id="edit-warehouse-title" className="text-base font-semibold text-app-fg">
            Edit warehouse
          </h3>
          <p className="text-sm text-app-fg-muted">
            Update the name, address, or coordinates of this company-owned warehouse.
          </p>
          <FormField label="Name" hint="e.g. Lagos main warehouse">
            <TextInput
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={160}
              autoFocus
            />
          </FormField>
          <FormField label="Address" hint="Street, area, city, state">
            <Textarea
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </FormField>
          <FormField label="Coordinates" hint="Optional — lat,lng">
            <TextInput
              value={editCoordinates}
              onChange={(e) => setEditCoordinates(e.target.value)}
              maxLength={100}
              placeholder="6.5244, 3.3792"
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isUpdating}
              disabled={!editReady}
              onClick={submitEdit}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
