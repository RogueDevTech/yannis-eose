import { useMemo, useState } from 'react';
import { Form, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, StatCard } from '~/components/ui/card';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormField } from '~/components/ui/form-field';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import { useFetcherToast } from '~/components/ui/toast';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { Tabs } from '~/components/ui/tabs';

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

  useFetcherToast(fetcher.data, {
    successMessage: 'Warehouse saved',
    skipErrorToast: showCreate,
  });

  const isCreating =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'createWarehouse';

  useCloseOnFetcherSuccess(fetcher, () => {
    setShowCreate(false);
    setName('');
    setAddress('');
    setCoordinates('');
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

  const display = [...optimisticWarehouses, ...warehouses];
  const ready = name.trim().length >= 2 && address.trim().length >= 2;

  const submit = () => {
    if (!ready) return;
    const fd = new FormData();
    fd.set('intent', 'createWarehouse');
    fd.set('name', name.trim());
    fd.set('address', address.trim());
    fd.set('coordinates', coordinates.trim());
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
      render: (w) => (
        <span className="tabular-nums text-sm text-success-600 dark:text-success-400">
          {Math.max(0, w.stockSummary.totalStock - w.stockSummary.totalReserved)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      nowrap: true,
      render: (w) => <StatusBadge status={w.status} />,
    },
    {
      key: 'dispatch',
      header: 'Dispatch',
      nowrap: true,
      render: (w) =>
        w.dispatchLocked ? (
          <StatusBadge status="LOCKED" variant="warning" label="Locked" />
        ) : (
          <span className="text-xs text-app-fg-muted">Open</span>
        ),
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
            <TableActionButton to={`/admin/inventory?locationId=${w.id}`} variant="primary">
              View stock
            </TableActionButton>
          </div>
        ),
    },
  ];

  const toolbar = useMemo(() => {
    return (
      <ToolbarFiltersCollapsible
        searchRow={
          <Form method="get" replace className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              name="search"
              defaultValue={search}
              placeholder="Search by warehouse name…"
              className="sm:max-w-xs"
              aria-label="Search warehouses"
            />
            <input type="hidden" name="page" value="1" />
            <Button type="submit" variant="secondary" size="sm" className="shrink-0">
              Search
            </Button>
          </Form>
        }
        desktopInlineFilters={<div />}
        sheetFilterBody={<div className="text-sm text-app-fg-muted">No extra filters.</div>}
        badgeCount={0}
        sheetTitle="Filters"
        sheetSubtitle="Search warehouses by name."
      />
    );
  }, [search]);

  return (
    <div className="space-y-4">
      <Tabs
        value="inhouse"
        onChange={() => {}}
        tabs={[
          {
            value: 'inhouse',
            label: 'Our warehouses',
            badge: (
              <span className="ml-1 inline-flex items-center rounded-full border border-brand-200/70 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 tabular-nums dark:border-brand-700/40 dark:bg-brand-900/20 dark:text-brand-200">
                {totalWarehouses}
              </span>
            ),
          },
        ]}
      />
      <PageHeader
        title="Our warehouses"
        description="Company sites used for intake, adjustments, and inbound shipments."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PageRefreshButton />
            {canManage ? (
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                Add warehouse
              </Button>
            ) : null}
          </div>
        }
      />

      <OverviewStatStrip
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
            valueClassName: 'text-info-600 dark:text-info-400',
          },
        ]}
      />

      <Card variant="default" padding="md">
        <CardHeader
          title="Warehouses"
          description={`${totalWarehouses} site${totalWarehouses === 1 ? '' : 's'} — internal facilities only (not partner logistics locations).`}
        />
        <div className="mb-4">{toolbar}</div>

        <CardBody className="p-0">
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
                rowClassName={(w) => (isOptimisticId(w.id) ? 'opacity-60' : '')}
                emptyTitle="No warehouses match your filter"
              />
            )}
          </TableLoadingOverlay>
        </CardBody>

        {totalPages > 1 ? (
          <CardFooter className="border-t border-app-border pt-4 mt-0">
            <Pagination page={page} totalPages={totalPages} />
            <span className="text-xs text-app-fg-muted">
              {limit} per page · {totalWarehouses} total
            </span>
          </CardFooter>
        ) : null}
      </Card>

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
    </div>
  );
}
