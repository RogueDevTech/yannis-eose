import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList } from '~/components/ui/description-list';
import { EmptyState } from '~/components/ui/empty-state';
import { FilterPills } from '~/components/ui/filter-pills';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { RoleBadge } from '~/components/ui/role-badge';
import { StatusBadge } from '~/components/ui/status-badge';
import { Tabs } from '~/components/ui/tabs';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import {
  deliveryRateColorClass,
  delinquencyRateColorClass,
} from '~/lib/rate-color';
import type { StockMovement } from '~/features/inventory/types';
import {
  MOVEMENT_COLORS,
  formatMovementReasonForDisplay,
  formatMovementType,
} from '~/features/inventory/types';
import type { Location } from './types';
import type { LogisticsProviderDetailRecord, LogisticsProviderRow } from './team-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNaira(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n) || n === 0) return '₦0';
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Movement helpers (mirrors inventory detail page) ─────────────────────────

type MovementWithProduct = StockMovement & { productName?: string | null };
type DirectionFilter = 'all' | 'in' | 'out';

const INCOMING_TYPES = new Set(['INTAKE', 'TRANSFER_IN', 'RESTOCK']);
const OUTGOING_TYPES = new Set(['DELIVERY', 'TRANSFER_OUT', 'WRITE_OFF', 'RETURN', 'DISPATCH']);

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

function movementColumns(
  onView: (m: MovementWithProduct) => void,
): CompactTableColumn<MovementWithProduct>[] {
  return [
    {
      key: 'when',
      header: 'When',
      nowrap: true,
      cellClassName: 'text-app-fg-muted',
      render: (m) => formatDateTime(m.createdAt),
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
      key: 'product',
      header: 'Product',
      nowrap: true,
      cellClassName: 'text-app-fg',
      render: (m) => m.productName ?? '—',
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

// ── Movement detail modal ────────────────────────────────────────────────────

function MovementDetailModal({
  movement,
  onClose,
}: {
  movement: MovementWithProduct | null;
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
  const cp = counterpartLabel(movement);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" backdropBlur contentClassName="p-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className={MOVEMENT_COLORS[movement.movementType] ?? 'badge'}>
            {formatMovementType(movement.movementType)}
          </span>
          <span className={`text-2xl font-bold tabular-nums ${qtyColor}`}>
            {qtyPrefix}{Math.abs(movement.quantity)}
          </span>
        </div>

        <DescriptionList
          divided
          items={[
            { label: 'When', value: formatDateTime(movement.createdAt) },
            { label: 'Product', value: movement.productName ?? '—' },
            {
              label: 'By',
              value: movement.actorName ? (
                <span className="inline-flex items-center gap-1.5">
                  <span>{movement.actorName}</span>
                  {movement.actorRole && <RoleBadge role={movement.actorRole} />}
                </span>
              ) : 'System',
            },
            ...(cp ? [{ label: 'Counterpart', value: cp }] : []),
            ...(movement.orderShortId
              ? [{
                  label: 'Order',
                  value: (
                    <OrderIdBadge
                      id={movement.orderShortId}
                      linkTo={`/admin/orders/${movement.orderShortId}`}
                    />
                  ),
                }]
              : []),
            ...(reasonDisplay
              ? [{ label: 'Reason', value: reasonDisplay }]
              : []),
            { label: 'Movement ID', value: <span className="font-mono text-xs">{movement.id}</span> },
          ]}
        />

        <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface MovementsData {
  movements: MovementWithProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  inQty: number;
  outQty: number;
  deliveredQty: number;
  products: { id: string; name: string }[];
}

export interface LogisticsProviderDetailPageProps {
  provider: LogisticsProviderDetailRecord;
  locations: Location[];
  performance: LogisticsProviderRow | null;
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  periodAllTime: boolean;
  backHref: string;
  movementsData: MovementsData;
  productFilter: string | null;
  locationFilter: string | null;
}

// ── Main component ───────────────────────────────────────────────────────────

export function LogisticsProviderDetailPage({
  provider,
  locations,
  performance,
  dateFilters,
  periodAllTime,
  backHref,
  movementsData,
  productFilter,
  locationFilter,
}: LogisticsProviderDetailPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'activity' ? 'activity' : 'overview';
  const loaderRefetchBusy = useLoaderRefetchBusy({ samePathnameOnly: true }).busy;
  const [selectedMovement, setSelectedMovement] = useState<MovementWithProduct | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>('all');

  const setTab = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === 'overview') {
        next.delete('tab');
      } else {
        next.set('tab', 'activity');
      }
      // Reset movements pagination when switching tabs
      next.delete('movementsPage');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleProductFilter = useCallback(
    (productId: string) => {
      const next = new URLSearchParams(searchParams);
      if (productId) {
        next.set('productId', productId);
      } else {
        next.delete('productId');
      }
      next.delete('movementsPage');
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleLocationFilter = useCallback(
    (locationId: string) => {
      const next = new URLSearchParams(searchParams);
      if (locationId) {
        next.set('locationId', locationId);
      } else {
        next.delete('locationId');
      }
      next.delete('movementsPage');
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const filteredMovements = useMemo(() => {
    if (direction === 'all') return movementsData.movements;
    return movementsData.movements.filter((m) => classifyMovement(m) === direction);
  }, [movementsData.movements, direction]);

  const isAllTime = periodAllTime || dateFilters.periodAllTime;

  const locationColumns: CompactTableColumn<Location>[] = [
    {
      key: 'name',
      header: 'Location',
      minWidth: 'min-w-[8rem]',
      render: (loc) => <span className="font-medium text-app-fg">{loc.name}</span>,
    },
    {
      key: 'address',
      header: 'Address',
      minWidth: 'min-w-[12rem]',
      render: (loc) => <span className="text-sm text-app-fg line-clamp-2">{loc.address}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      tight: true,
      render: (loc) => <StatusBadge status={loc.status} />,
    },
    {
      key: 'dispatch',
      header: 'Dispatch',
      tight: true,
      render: (loc) => (loc.dispatchLocked ? <span className="text-warning-600 text-xs">Locked</span> : '—'),
    },
  ];

  const rateCardJson =
    provider.rateCard != null && typeof provider.rateCard === 'object'
      ? JSON.stringify(provider.rateCard, null, 2)
      : null;

  const cols = useMemo(() => movementColumns(setSelectedMovement), []);

  return (
    <div className="space-y-4 w-full min-w-0">
      <Breadcrumb
        items={[
          { label: 'Logistics', to: '/admin/logistics/partners' },
          { label: 'Team analysis', to: backHref },
          { label: provider.name },
        ]}
      />

      <PageHeader
        title={provider.name}
        backTo="/admin/logistics/partners"
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={provider.status} />
            <span className="text-app-fg-muted">{provider.locationCount} location{provider.locationCount === 1 ? '' : 's'}</span>
          </span>
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Provider toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={periodAllTime} chrome="pill" />
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={periodAllTime}
      />

      <Tabs
        value={activeTab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          {
            value: 'activity',
            label: 'Stock activity',
            badge:
              movementsData.total > 0 ? (
                <span className="rounded-full bg-app-hover px-1.5 py-0.5 text-micro font-semibold text-app-fg-muted tabular-nums">
                  {movementsData.total}
                </span>
              ) : undefined,
          },
        ]}
      />

      <TableLoadingOverlay show={loaderRefetchBusy} minHeightClassName="min-h-[16rem]">
        {activeTab === 'overview' ? (
          <>
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">Company</h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                { label: 'Contact', value: provider.contactInfo?.trim() || '—', valueClassName: 'text-app-fg' },
                { label: 'Coverage', value: provider.coverageArea?.trim() || '—', valueClassName: 'text-app-fg' },
                { label: 'Created', value: formatDate(provider.createdAt), valueClassName: 'text-app-fg' },
              ]}
            />
          </div>

          {performance ? (
            <div>
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">Performance</h2>
              <OverviewStatStrip
                mobileGrid
                tileClassName="!py-2.5"
                items={[
                { label: 'Assigned', value: performance.totalAssigned, valueClassName: 'text-app-fg' },
                { label: 'Delivered', value: performance.delivered, valueClassName: 'text-success-600 dark:text-success-400' },
                { label: 'Units delivered', value: performance.unitsDelivered.toLocaleString(), valueClassName: 'text-app-fg' },
                { label: 'Delivery rate', value: performance.totalAssigned > 0 ? `${Math.round(performance.deliveryRate)}%` : '—', valueClassName: deliveryRateColorClass(performance.deliveryRate) },
                { label: 'Delinquency', value: performance.totalAssigned > 0 ? `${Math.round(performance.delinquencyRate)}%` : '—', valueClassName: delinquencyRateColorClass(performance.delinquencyRate) },
                { label: 'Returned', value: performance.returned, valueClassName: 'text-app-fg-muted' },
                { label: 'Remitted', value: formatNaira(performance.remittedAmount), valueClassName: 'text-success-600 dark:text-success-400' },
                { label: 'Pending', value: formatNaira(performance.pendingRemittanceAmount), valueClassName: 'text-warning-600 dark:text-warning-400' },
                { label: 'Disputed', value: formatNaira(performance.disputedRemittanceAmount), valueClassName: 'text-danger-600 dark:text-danger-400' },
              ]}
              />
            </div>
          ) : null}

          {rateCardJson ? (
            <div>
              <p className="text-xs font-medium text-app-fg-muted mb-2">Rate card (reference)</p>
              <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-x-auto max-h-48 text-app-fg">
                {rateCardJson}
              </pre>
            </div>
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Locations</h2>
              <Link
                to="/admin/logistics/partners"
                className="text-xs font-medium text-brand-500 hover:text-brand-600"
              >
                Manage
              </Link>
            </div>
            {locations.length === 0 ? (
              <p className="text-sm text-app-fg-muted">No locations recorded for this company yet.</p>
            ) : (
              <CompactTable<Location>
                columns={locationColumns}
                rows={locations}
                rowKey={(loc) => loc.id}
                emptyTitle="No locations"
                emptyDescription="Add a warehouse or hub from the Partners page."
              />
            )}
          </div>
          </>
        ) : (
          /* ── Stock Activity tab ─────────────────────────────────────────── */
          <div className="space-y-4">
            <OverviewStatStrip
              mobileGrid
              tileClassName="min-w-[7rem]"
              items={[
                {
                  label: isAllTime ? 'Sold (all time)' : 'Sold (period)',
                  value: movementsData.deliveredQty,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  title: 'Units delivered/sold in the selected date range',
                },
                {
                  label: isAllTime ? 'In (all time)' : 'In (period)',
                  value: `+${movementsData.inQty}`,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  title: 'Total units received in the selected date range',
                },
                {
                  label: isAllTime ? 'Out (all time)' : 'Out (period)',
                  value: `−${movementsData.outQty}`,
                  valueClassName: 'text-danger-600 dark:text-danger-400',
                  title: 'Total units delivered, transferred out, or written off in the selected date range',
                },
              ]}
            />

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <FilterPills
                value={direction}
                onChange={(v) => setDirection(v as DirectionFilter)}
                options={[
                  { value: 'all', label: `All (${movementsData.total})` },
                  { value: 'in', label: 'Stock in' },
                  { value: 'out', label: 'Stock out' },
                ]}
              />

              {movementsData.products.length > 1 && (
                <FormSelect
                  value={productFilter ?? ''}
                  onChange={(e) => handleProductFilter(e.target.value)}
                  className="w-full sm:w-56"
                >
                  <option value="">All products</option>
                  {movementsData.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </FormSelect>
              )}

              {locations.length > 1 && (
                <FormSelect
                  value={locationFilter ?? ''}
                  onChange={(e) => handleLocationFilter(e.target.value)}
                  className="w-full sm:w-56"
                >
                  <option value="">All locations</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </FormSelect>
              )}
            </div>

            <CompactTable<MovementWithProduct>
              rows={filteredMovements}
              rowKey={(m) => m.id}
              emptyTitle={movementsData.total === 0 ? 'No stock activity in this range' : 'No matching movements'}
              emptyDescription={
                movementsData.total === 0
                  ? 'Adjust the date filter or wait for stock activity.'
                  : 'Switch the filter to see other stock events.'
              }
              columns={cols}
              renderMobileCard={(m) => {
                const dir = classifyMovement(m);
                const qtyColor =
                  dir === 'in'
                    ? 'text-success-600 dark:text-success-400'
                    : dir === 'out'
                      ? 'text-danger-600 dark:text-danger-400'
                      : 'text-app-fg-muted';
                const qtyPrefix = dir === 'in' ? '+' : dir === 'out' ? '−' : '→';
                return (
                  <button
                    type="button"
                    onClick={() => setSelectedMovement(m)}
                    className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={MOVEMENT_COLORS[m.movementType] ?? 'badge'}>
                        {formatMovementType(m.movementType)}
                      </span>
                      <span className={`text-sm font-bold tabular-nums ${qtyColor}`}>
                        {qtyPrefix}{Math.abs(m.quantity)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-app-fg-muted">
                      <span className="font-medium text-app-fg">{m.productName ?? '—'}</span>
                      <span>·</span>
                      <span>{formatDateTime(m.createdAt)}</span>
                    </div>
                    {m.actorName && (
                      <p className="text-xs text-app-fg-muted truncate">by {m.actorName}</p>
                    )}
                  </button>
                );
              }}
            />

            {movementsData.totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-app-fg-muted">
                  Showing {(movementsData.page - 1) * movementsData.limit + 1}–
                  {Math.min(movementsData.page * movementsData.limit, movementsData.total)} of{' '}
                  {movementsData.total} movements
                </p>
                <Pagination
                  page={movementsData.page}
                  totalPages={movementsData.totalPages}
                  pageParam="movementsPage"
                  pageSize={movementsData.limit}
                />
              </div>
            )}
          </div>
        )}
      </TableLoadingOverlay>

      <MovementDetailModal
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />
    </div>
  );
}
