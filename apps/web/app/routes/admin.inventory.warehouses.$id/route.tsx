import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';

import { Await, Form, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
} from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { Card, CardBody } from '~/components/ui/card';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { Pagination } from '~/components/ui/pagination';
import { WarehouseShipmentsLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';

export const meta: MetaFunction = () => [{ title: 'Warehouse shipments — Yannis EOSE' }];

function requireUuidParam(raw: string | undefined, label: string): string {
  const v = (raw ?? '').trim();
  // UUIDv7 still matches the canonical UUID regex.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v)) {
    throw new Response(`${label} not found`, { status: 404 });
  }
  return v;
}

const SHIPMENT_STATUSES = [
  'ALL',
  'CREATED',
  'IN_TRANSIT',
  'ARRIVED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED',
] as const;

type ShipmentStatusFilter = (typeof SHIPMENT_STATUSES)[number];

type ShipmentRow = {
  id: string;
  referenceLabel: string;
  label: string | null;
  status: string;
  supplierName: string | null;
  supplierReference: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  verifiedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  lineCount: number;
  totalExpected: number;
  totalReceived: number;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');
  const cookie = getSessionCookie(request);
  const warehouseId = requireUuidParam(params['id'], 'Warehouse');

  const url = new URL(request.url);
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const rawSearch = (url.searchParams.get('search') ?? '').trim();
  const rawStatus = (url.searchParams.get('status') ?? 'ALL').toUpperCase();
  const status = (SHIPMENT_STATUSES.includes(rawStatus as ShipmentStatusFilter)
    ? (rawStatus as ShipmentStatusFilter)
    : 'ALL') satisfies ShipmentStatusFilter;

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const pageData = (async () => {
    const listInput: {
      destinationLocationId: string;
      page: number;
      limit: number;
      search?: string;
      status?: Exclude<ShipmentStatusFilter, 'ALL'>;
    } = { destinationLocationId: warehouseId, page, limit: 20 };

    if (rawSearch) listInput.search = rawSearch;
    if (status !== 'ALL') listInput.status = status;

    const [warehouseRes, shipmentsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/inventory.warehouses.get?input=${encodeURIComponent(JSON.stringify({ warehouseId }))}`,
        deferredOpt,
      ),
      apiRequest<unknown>(
        `/trpc/inventory.shipments.list?input=${encodeURIComponent(JSON.stringify(listInput))}`,
        deferredOpt,
      ),
    ]);

    const warehouse = warehouseRes.ok
      ? ((warehouseRes.data as { result?: { data?: { id: string; name: string; address: string } } })?.result
          ?.data ?? null)
      : null;

    const shipmentsData = shipmentsRes.ok
      ? ((shipmentsRes.data as {
          result?: {
            data?: { rows: ShipmentRow[]; pagination: { total: number; totalPages: number } };
          };
        })?.result?.data ?? null)
      : null;

    return {
      warehouseId,
      page,
      search: rawSearch,
      status,
      rows: shipmentsData?.rows ?? [],
      total: shipmentsData?.pagination?.total ?? 0,
      totalPages: shipmentsData?.pagination?.totalPages ?? 1,
      warehouse,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

type WarehouseShipmentsPageProps = {
  warehouseId: string;
  page: number;
  search: string;
  status: ShipmentStatusFilter;
  rows: ShipmentRow[];
  total: number;
  totalPages: number;
  warehouse: { id: string; name: string; address: string } | null;
};

function WarehouseShipmentsPage(data: WarehouseShipmentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const columns: CompactTableColumn<ShipmentRow>[] = [
    {
      key: 'ref',
      header: 'Reference',
      render: (s) => (
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-sm font-medium text-app-fg truncate">{s.referenceLabel}</span>
          {s.label ? <span className="text-xs text-app-fg-muted truncate">{s.label}</span> : null}
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (s) => (
        <div className="flex flex-col min-w-0">
          <span className="text-sm text-app-fg truncate">{s.supplierName ?? '—'}</span>
          {s.supplierReference ? (
            <span className="text-xs text-app-fg-muted truncate">{s.supplierReference}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      nowrap: true,
      render: (s) => <StatusBadge status={s.status} />,
    },
    {
      key: 'lines',
      header: 'Lines',
      align: 'right',
      nowrap: true,
      render: (s) => (
        <span className="text-sm text-app-fg tabular-nums">
          {s.lineCount} ({s.totalExpected} units)
        </span>
      ),
    },
  ];

  const statusOptions = SHIPMENT_STATUSES.map((s) => ({
    value: s,
    label: s === 'ALL' ? 'All statuses' : s.replaceAll('_', ' '),
  }));

  const onStatusChange = (next: string) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('status', next);
    sp.set('page', '1');
    setSearchParams(sp, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Warehouse shipments"
        description="All inbound shipments received (or planned) for this warehouse."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Link to="/admin/inventory/warehouses">
              <Button variant="secondary" size="sm">
                Back to warehouses
              </Button>
            </Link>
          </div>
        }
      />

      <Card variant="default" padding="md">
        <ToolbarFiltersCollapsible
          searchRow={
            <Form method="get" replace className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                name="search"
                defaultValue={data.search}
                placeholder="Search shipments…"
                className="sm:max-w-sm"
                aria-label="Search shipments"
              />
              <input type="hidden" name="page" value="1" />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                Search
              </Button>
            </Form>
          }
          desktopInlineFilters={
            <FormSelect
              label="Status"
              value={data.status}
              onChange={(e) => onStatusChange(e.target.value)}
              options={statusOptions}
            />
          }
          sheetFilterBody={
            <FormSelect
              label="Status"
              value={data.status}
              onChange={(e) => onStatusChange(e.target.value)}
              options={statusOptions}
            />
          }
          badgeCount={data.status !== 'ALL' ? 1 : 0}
          sheetTitle="Filters"
          sheetSubtitle="Narrow by status or search."
        />

        <CardBody className="p-0">
          {data.rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                variant="card"
                title="No shipments found"
                description="Try clearing filters or receiving a shipment into this warehouse."
              />
            </div>
          ) : (
            <CompactTable columns={columns} rows={data.rows} rowKey={(r) => r.id} />
          )}
        </CardBody>

        {data.totalPages > 1 ? (
          <div className="border-t border-app-border p-4">
            <Pagination page={data.page} totalPages={data.totalPages} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function WarehouseShipmentsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<WarehouseShipmentsLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {(data) => <WarehouseShipmentsPage {...data} />}
      </CachedAwait>
  );
}

