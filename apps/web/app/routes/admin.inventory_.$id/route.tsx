import { useMemo, useState } from 'react';
import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { FilterPills } from '~/components/ui/filter-pills';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Tabs } from '~/components/ui/tabs';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { Modal } from '~/components/ui/modal';
import { RoleBadge } from '~/components/ui/role-badge';
import { DescriptionList } from '~/components/ui/description-list';
import { Button } from '~/components/ui/button';
import type { StockMovement } from '~/features/inventory/types';
import { MOVEMENT_COLORS, formatMovementReasonForDisplay, formatMovementType } from '~/features/inventory/types';
import { InventoryLevelDetailLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Level Detail — Yannis EOSE' },
];

interface LevelBatch {
  id: string;
  factoryCost: string;
  landingCost: string;
  totalLandedCost: string;
  quantity: number;
  remainingQuantity: number;
  receivedAt: string;
}

interface LevelHeader {
  id: string;
  productId: string;
  productName: string | null;
  locationId: string;
  locationName: string | null;
  stockCount: number;
  reservedCount: number;
  status: string;
  updatedAt: string;
}

interface LoaderData {
  level: LevelHeader | null;
  batches: LevelBatch[];
  movements: StockMovement[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  inQty: number;
  outQty: number;
  startDate: string | null;
  endDate: string | null;
}

const PAGE_SIZE = 20;

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });

  const id = params['id'];
  if (!id) throw new Response('Inventory level ID required', { status: 400 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const startDate = url.searchParams.get('startDate')?.trim() || undefined;
  const endDate = url.searchParams.get('endDate')?.trim() || undefined;

  const cookie = getSessionCookie(request);

  const pageData = (async (): Promise<LoaderData> => {
    const input: Record<string, unknown> = { id, page, limit: PAGE_SIZE };
    if (startDate) input['startDate'] = startDate;
    if (endDate) input['endDate'] = endDate;
    const res = await apiRequest<unknown>(
      `/trpc/inventory.getLevelById?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );

    if (!res.ok) {
      return {
        level: null,
        batches: [],
        movements: [],
        total: 0,
        page: 1,
        limit: PAGE_SIZE,
        totalPages: 1,
        inQty: 0,
        outQty: 0,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      };
    }

    const data = (res.data as {
      result?: {
        data?: {
          level: LevelHeader;
          batches: LevelBatch[];
          movements: StockMovement[];
          total: number;
          page: number;
          limit: number;
          totalPages: number;
          inQty: number;
          outQty: number;
        };
      };
    })?.result?.data;

    return {
      level: data?.level ?? null,
      batches: data?.batches ?? [],
      movements: data?.movements ?? [],
      total: data?.total ?? 0,
      page: data?.page ?? page,
      limit: data?.limit ?? PAGE_SIZE,
      totalPages: data?.totalPages ?? 1,
      inQty: data?.inQty ?? 0,
      outQty: data?.outQty ?? 0,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

type DirectionFilter = 'all' | 'in' | 'out';

const INCOMING_TYPES = new Set(['INTAKE', 'TRANSFER_IN', 'RESTOCK']);
const OUTGOING_TYPES = new Set([
  'DELIVERY',
  'TRANSFER_OUT',
  'WRITE_OFF',
  'RETURN',
  'DISPATCH',
]);

function classifyMovement(m: StockMovement): 'in' | 'out' | 'neutral' {
  if (INCOMING_TYPES.has(m.movementType)) return 'in';
  if (OUTGOING_TYPES.has(m.movementType)) return 'out';
  if (m.movementType === 'ADJUSTMENT') return m.quantity >= 0 ? 'in' : 'out';
  return 'neutral';
}

function counterpartLabel(m: StockMovement): string | null {
  if (m.movementType === 'TRANSFER_OUT' && m.toLocationName) return `to ${m.toLocationName}`;
  if (m.movementType === 'TRANSFER_IN' && m.fromLocationName) return `from ${m.fromLocationName}`;
  return null;
}

function auditTrailColumns(
  onView: (m: StockMovement) => void,
): CompactTableColumn<StockMovement>[] {
  return [
    {
      key: 'when',
      header: 'When',
      nowrap: true,
      cellClassName: 'text-app-fg-muted',
      render: (m) =>
        new Date(m.createdAt).toLocaleString('en-NG', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      key: 'type',
      header: 'Type',
      nowrap: true,
      render: (m) => (
        <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
          {formatMovementType(m.movementType)}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      nowrap: true,
      cellClassName: (m) => {
        const dir = classifyMovement(m);
        if (dir === 'in') return 'font-semibold text-success-600 dark:text-success-400';
        if (dir === 'out') return 'font-semibold text-danger-600 dark:text-danger-400';
        return 'font-semibold text-app-fg-muted';
      },
      render: (m) => {
        const dir = classifyMovement(m);
        const prefix = dir === 'in' ? '+' : dir === 'out' ? '−' : '→';
        return `${prefix}${Math.abs(m.quantity)}`;
      },
    },
    {
      key: 'by',
      header: 'By',
      nowrap: true,
      render: (m) =>
        m.actorName ? (
          <span className="font-medium text-app-fg">{m.actorName}</span>
        ) : (
          <span className="italic text-app-fg-muted">System</span>
        ),
    },
    {
      key: 'reference',
      header: 'Reference',
      nowrap: true,
      cellClassName: 'text-app-fg-muted',
      render: (m) => {
        if (m.orderShortId) {
          return <OrderIdBadge id={m.orderShortId} linkTo={`/admin/orders/${m.orderShortId}`} />;
        }
        const cp = counterpartLabel(m);
        if (cp) return <span>{cp}</span>;
        return <span>—</span>;
      },
    },
    {
      key: 'reason',
      header: 'Reason',
      cellClassName: 'text-app-fg-muted italic truncate max-w-xs',
      cellTitle: (m) => {
        const r = formatMovementReasonForDisplay(m.reason);
        return r || undefined;
      },
      render: (m) => formatMovementReasonForDisplay(m.reason) || '—',
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      tight: true,
      render: (m) => (
        <CompactTableActionButton onClick={() => onView(m)}>View</CompactTableActionButton>
      ),
    },
  ];
}

type TabId = 'batches' | 'audit';

function InventoryLevelDetailRouteInner({
  level,
  batches,
  movements,
  total,
  page,
  totalPages,
  inQty,
  outQty,
  startDate,
  endDate,
}: LoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  // URL-driven tab state (so back/forward + deep links work).
  // Default is Movement history (audit) per ops workflow.
  const activeTab: TabId = searchParams.get('tab') === 'batches' ? 'batches' : 'audit';
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<LevelBatch | null>(null);

  const filteredMovements = useMemo(() => {
    if (direction === 'all') return movements;
    return movements.filter((m) => classifyMovement(m) === direction);
  }, [movements, direction]);

  const periodAllTime = !startDate && !endDate;

  if (!level) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inventory level" />
        <EmptyState
          variant="card"
          title="Inventory level not found"
          description="It may have been deleted or you do not have access."
        />
      </div>
    );
  }

  const available = level.stockCount - level.reservedCount;
  const productLabel = level.productName ?? 'Unknown product';
  const locationLabel = level.locationName ?? 'Unknown location';

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={
          <Link
            to="/admin/inventory"
            prefetch="intent"
            className="text-xs text-app-fg-muted hover:text-app-fg transition-colors inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Inventory
          </Link>
        }
        title={productLabel}
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5 shrink-0 text-app-fg-muted">
              <svg className="w-3.5 h-3.5 text-app-fg-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="uppercase tracking-wide text-[11px] font-medium">Stock location</span>
            </span>
            <span className="font-semibold text-app-fg">{locationLabel}</span>
          </span>
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Inventory level tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Inventory level toolbar"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
                  <DateFilterBar startDate={startDate ?? undefined} endDate={endDate ?? undefined} />
                </div>
                <PageRefreshButton />
              </>
            }
            sheet={
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={startDate ?? undefined}
                  endDate={endDate ?? undefined}
                  triggerLayout="blockCenter"
                />
              </div>
            }
          />
        }
      />

      {/* Overview — live state + date-filtered movement totals (in/out within range) */}
      <OverviewStatStrip
        tileClassName="min-w-[7rem]"
        items={[
          {
            label: 'Stock',
            value: level.stockCount,
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Reserved',
            value: level.reservedCount,
            valueClassName: 'text-warning-600 dark:text-warning-400',
          },
          {
            label: 'Available',
            value: available,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Status',
            value: <StatusBadge status={level.status} />,
            plainValue: true,
          },
          {
            label: periodAllTime ? 'In (all time)' : 'In (period)',
            value: `+${inQty}`,
            valueClassName: 'text-success-600 dark:text-success-400',
            title: 'Total units received in the selected date range',
          },
          {
            label: periodAllTime ? 'Out (all time)' : 'Out (period)',
            value: `−${outQty}`,
            valueClassName: 'text-danger-600 dark:text-danger-400',
            title: 'Total units delivered, transferred out, or written off in the selected date range',
          },
          {
            label: 'Net',
            value: `${inQty - outQty >= 0 ? '+' : ''}${inQty - outQty}`,
            valueClassName:
              inQty - outQty >= 0
                ? 'text-success-600 dark:text-success-400'
                : 'text-danger-600 dark:text-danger-400',
          },
          {
            label: 'Events',
            value: total,
            valueClassName: 'text-app-fg',
          },
        ]}
      />

      {/* Tabs: received stock / costing vs movement log */}
      <Tabs
        value={activeTab}
        onChange={(v) => {
          const next = new URLSearchParams(searchParams);
          next.set('tab', v === 'batches' ? 'batches' : 'audit');
          // Tab switches should not affect pagination, but if we ever add
          // tab-specific paging, resetting to page=1 is the safer default.
          next.delete('page');
          setSearchParams(next, { replace: true });
        }}
        tabs={[
          {
            value: 'batches',
            label: `Received stock · ${locationLabel}`,
          },
          { value: 'audit', label: `Movement history (${total})` },
        ]}
      />

      {activeTab === 'batches' && (
        <CompactTable<LevelBatch>
          rows={batches}
          rowKey={(b) => b.id}
          rowClassName={(b) => (b.remainingQuantity === 0 ? 'opacity-60' : '')}
          emptyTitle="No receipts at this location yet"
          emptyDescription="Each intake you record here becomes a cost layer (used for profit and FIFO costing)."
          columns={[
            {
              key: 'received',
              header: 'Received',
              cellClassName: 'text-app-fg-muted',
              render: (b) =>
                new Date(b.receivedAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
            },
            {
              key: 'quantity',
              header: 'Intake qty',
              align: 'right',
              cellClassName: 'font-medium text-app-fg',
              render: (b) => b.quantity,
            },
            {
              key: 'remaining',
              header: 'Remaining',
              align: 'right',
              cellClassName: (b) =>
                `font-medium ${b.remainingQuantity === 0 ? 'text-app-fg-muted' : 'text-success-600 dark:text-success-400'}`,
              render: (b) => b.remainingQuantity,
            },
            {
              key: 'factoryCost',
              header: 'Factory ₦',
              align: 'right',
              cellClassName: 'text-app-fg-muted',
              render: (b) => Number(b.factoryCost).toLocaleString(),
            },
            {
              key: 'landingCost',
              header: 'Landing ₦',
              align: 'right',
              cellClassName: 'text-app-fg-muted',
              render: (b) => Number(b.landingCost).toLocaleString(),
            },
            {
              key: 'totalLanded',
              header: 'Landed ₦',
              align: 'right',
              cellClassName: 'font-medium text-app-fg',
              render: (b) => Number(b.totalLandedCost).toLocaleString(),
            },
            {
              key: 'action',
              header: 'Action',
              align: 'right',
              tight: true,
              render: (b) => (
                <CompactTableActionButton onClick={() => setSelectedBatch(b)}>
                  View
                </CompactTableActionButton>
              ),
            },
          ]}
        />
      )}

      {activeTab === 'audit' && (
        <>
          {total > 0 && (
            <div>
              <FilterPills
                value={direction}
                onChange={(v) => setDirection(v as DirectionFilter)}
                options={[
                  { value: 'all', label: `All (${total})` },
                  { value: 'in', label: 'Stock in' },
                  { value: 'out', label: 'Stock out' },
                ]}
              />
            </div>
          )}

          <CompactTable<StockMovement>
            rows={filteredMovements}
            rowKey={(m) => m.id}
            pagination={{ page, totalPages }}
            emptyTitle={total === 0 ? 'No movements in this range' : 'No matching movements'}
            emptyDescription={
              total === 0
                ? 'Adjust the date filter or wait for stock activity.'
                : 'Switch the filter to see other stock events.'
            }
            columns={auditTrailColumns(setSelectedMovement)}
          />
        </>
      )}

      <AuditMovementDetailModal
        movement={selectedMovement}
        locationLabel={locationLabel}
        onClose={() => setSelectedMovement(null)}
      />
      <BatchDetailModal
        batch={selectedBatch}
        locationLabel={locationLabel}
        onClose={() => setSelectedBatch(null)}
      />
    </div>
  );
}

export default function InventoryLevelDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<InventoryLevelDetailLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {(data) => <InventoryLevelDetailRouteInner {...data} />}
      </CachedAwait>
  );
}

function AuditMovementDetailModal({
  movement,
  locationLabel,
  onClose,
}: {
  movement: StockMovement | null;
  locationLabel: string;
  onClose: () => void;
}) {
  if (!movement) return null;
  const reasonDisplay = formatMovementReasonForDisplay(movement.reason);
  const dir = classifyMovement(movement);
  const qtyColor =
    dir === 'in'
      ? 'text-success-600 dark:text-success-400'
      : dir === 'out'
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-app-fg-muted';
  const qtyPrefix = dir === 'in' ? '+' : dir === 'out' ? '−' : '→';
  const counterpartLabel =
    movement.movementType === 'TRANSFER_OUT' && movement.toLocationName
      ? `to ${movement.toLocationName}`
      : movement.movementType === 'TRANSFER_IN' && movement.fromLocationName
        ? `from ${movement.fromLocationName}`
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      backdropBlur
      aria-labelledby="audit-movement-detail-title"
    >
      <div className="space-y-5 px-5 pt-5 md:px-6 md:pt-6 pb-2">
        <div>
          <h2 id="audit-movement-detail-title" className="text-base font-semibold text-app-fg">
            Movement details
          </h2>
          <p className="text-xs text-app-fg-muted mt-0.5">Stock event at {locationLabel}</p>
        </div>

        <div className="rounded-lg border border-app-border bg-app-canvas px-4 py-3 flex items-center justify-between gap-3">
          <span className={MOVEMENT_COLORS[movement.movementType] ?? 'badge'}>
            {formatMovementType(movement.movementType)}
          </span>
          <span className={`text-2xl font-semibold ${qtyColor}`}>
            {qtyPrefix}{Math.abs(movement.quantity)}
            <span className="text-sm font-normal text-app-fg-muted ml-1">units</span>
          </span>
        </div>

        <DescriptionList
          layout="horizontal"
          divided
          items={[
            {
              label: 'When',
              value: new Date(movement.createdAt).toLocaleString('en-NG', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            },
            {
              label: 'By',
              value: movement.actorName ? (
                <span className="inline-flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-app-fg">{movement.actorName}</span>
                  {movement.actorRole && <RoleBadge role={movement.actorRole} />}
                </span>
              ) : (
                <span className="italic text-app-fg-muted">System</span>
              ),
            },
            ...(counterpartLabel
              ? [{ label: 'Counterpart', value: counterpartLabel }]
              : []),
            ...(movement.orderShortId
              ? [
                  {
                    label: 'Order',
                    value: (
                      <OrderIdBadge id={movement.orderShortId} linkTo={`/admin/orders/${movement.orderShortId}`} />
                    ),
                  },
                ]
              : []),
            {
              label: 'Reason',
              value: reasonDisplay ? (
                <span className="italic">{reasonDisplay}</span>
              ) : (
                <span className="text-app-fg-muted">—</span>
              ),
              fullWidth: true,
            },
            {
              label: 'Movement ID',
              value: <span className="font-mono text-xs break-all">{movement.id}</span>,
              fullWidth: true,
            },
          ]}
        />

        <div className="flex justify-end pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BatchDetailModal({
  batch,
  locationLabel,
  onClose,
}: {
  batch: LevelBatch | null;
  locationLabel: string;
  onClose: () => void;
}) {
  if (!batch) return null;
  const used = batch.quantity - batch.remainingQuantity;
  const depleted = batch.remainingQuantity === 0;
  const remainingColor = depleted
    ? 'text-app-fg-muted'
    : 'text-success-600 dark:text-success-400';

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      backdropBlur
      aria-labelledby="batch-detail-title"
    >
      <div className="space-y-5 px-5 pt-5 md:px-6 md:pt-6 pb-2">
        <div>
          <h2 id="batch-detail-title" className="text-base font-semibold text-app-fg">
            Stock receipt
          </h2>
          <p className="text-xs text-app-fg-muted mt-0.5">Cost layer at {locationLabel} (FIFO)</p>
        </div>

        <div className="rounded-lg border border-app-border bg-app-canvas px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Remaining</span>
            <span className={`text-2xl font-semibold ${remainingColor}`}>
              {batch.remainingQuantity}
              <span className="text-sm font-normal text-app-fg-muted ml-1">/ {batch.quantity}</span>
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-app-hover overflow-hidden">
            <div
              className={depleted ? 'h-full bg-app-border' : 'h-full bg-success-500'}
              style={{
                width: batch.quantity > 0
                  ? `${Math.max(0, Math.min(100, (batch.remainingQuantity / batch.quantity) * 100))}%`
                  : '0%',
              }}
            />
          </div>
        </div>

        <DescriptionList
          layout="horizontal"
          divided
          items={[
            {
              label: 'Received',
              value: new Date(batch.receivedAt).toLocaleString('en-NG', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            },
            {
              label: 'Intake qty',
              value: <span className="font-medium text-app-fg">{batch.quantity}</span>,
            },
            {
              label: 'Used',
              value: <span className="font-medium text-app-fg">{used}</span>,
            },
            {
              label: 'Factory cost',
              value: <span className="text-app-fg">₦{Number(batch.factoryCost).toLocaleString()}</span>,
            },
            {
              label: 'Landing cost',
              value: <span className="text-app-fg">₦{Number(batch.landingCost).toLocaleString()}</span>,
            },
            {
              label: 'Total landed',
              value: (
                <span className="font-semibold text-app-fg">
                  ₦{Number(batch.totalLandedCost).toLocaleString()}
                </span>
              ),
            },
            {
              label: 'Batch ID',
              value: <span className="font-mono text-xs break-all">{batch.id}</span>,
              fullWidth: true,
            },
          ]}
        />

        <div className="flex justify-end pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
