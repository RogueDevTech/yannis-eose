import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { formatOrderNumber } from '@yannis/shared';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Button } from '~/components/ui/button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList } from '~/components/ui/description-list';
import { DotSeparator, DualValue } from '~/components/ui/dot-separator';
import { FilterPills } from '~/components/ui/filter-pills';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Pagination } from '~/components/ui/pagination';
import { RoleBadge } from '~/components/ui/role-badge';
import { StatusBadge } from '~/components/ui/status-badge';
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

// ── Stock consistency check ─────────────────────────────────────────────────

interface StockBreakdownRow {
  received: number;
  sold: number;
  transferredOut: number;
  adjusted: number;
  writtenOff: number;
  dispatched: number;
  reserved: number;
  available: number;
}

function checkConsistency(row: StockBreakdownRow) {
  const expectedAvailable = row.received - row.sold - row.transferredOut + row.adjusted - row.writtenOff - row.reserved;
  const diff = row.available - expectedAvailable;
  return { expectedAvailable, diff, isConsistent: diff === 0 };
}

function generateStockReport(
  name: string,
  row: StockBreakdownRow & { qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string },
  providerName: string,
): string {
  const { expectedAvailable, diff, isConsistent } = checkConsistency(row);
  const lines: string[] = [];

  lines.push(`STOCK RECONCILIATION REPORT`);
  lines.push(`==========================`);
  lines.push(`Provider: ${providerName}`);
  lines.push(`Location/Product: ${name}`);
  lines.push(`Generated: ${new Date().toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}`);
  lines.push('');
  lines.push(`STOCK FLOW SUMMARY`);
  lines.push(`------------------`);
  const netReceived = row.received + row.adjusted;
  lines.push(`Received:            ${netReceived.toLocaleString()} units`);
  lines.push(`Sold (Delivered):    ${row.sold.toLocaleString()} units`);
  lines.push(`Transferred Out:     ${row.transferredOut > 0 ? '−' : ''}${row.transferredOut.toLocaleString()} units`);
  lines.push(`Reserved:            ${row.reserved.toLocaleString()} units`);
  lines.push('');
  lines.push(`BALANCE`);
  lines.push(`-------`);
  lines.push(`Expected Available:  ${expectedAvailable.toLocaleString()} units`);
  lines.push(`Actual Available:    ${row.available.toLocaleString()} units`);

  if (isConsistent) {
    lines.push(`Status:              ✓ CONSISTENT — all stock is accounted for.`);
  } else {
    lines.push(`Discrepancy:         ${diff > 0 ? '+' : ''}${diff.toLocaleString()} units`);
    lines.push(`Status:              ✗ INCONSISTENT`);
    lines.push('');
    lines.push(`EXPLANATION`);
    lines.push(`-----------`);
    if (diff > 0) {
      lines.push(`There are ${diff.toLocaleString()} more units on hand than expected.`);
      lines.push(`Possible causes: unrecorded intake, positive adjustment not captured,`);
      lines.push(`or a transfer-in that was not logged as a receipt.`);
    } else {
      lines.push(`There are ${Math.abs(diff).toLocaleString()} fewer units on hand than expected.`);
      lines.push(`Possible causes: unrecorded sale, stock loss, theft, damage not`);
      lines.push(`written off, or a dispatch/transfer that was not logged.`);
    }
  }

  lines.push('');
  lines.push(`REMITTANCE STATUS`);
  lines.push(`-----------------`);
  lines.push(`Remitted:   ${row.qtyRemitted.toLocaleString()} units (${formatNaira(row.amountRemitted)})`);
  lines.push(`Pending:    ${row.qtyPending.toLocaleString()} units (${formatNaira(row.amountPending)})`);

  if (row.qtyAwaitingRemittance > 0) {
    lines.push(`Awaiting:   ${row.qtyAwaitingRemittance.toLocaleString()} units (${formatNaira(row.amountAwaitingRemittance)}) — delivered, no remittance batch yet`);
  }

  lines.push('');
  lines.push(`--- End of Report ---`);
  return lines.join('\n');
}

function downloadReport(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
          return <OrderIdBadge id={m.orderShortId} orderNumber={m.orderNumber} linkTo={`/admin/orders/${m.orderShortId}`} />;
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
        let r = formatMovementReasonForDisplay(m.reason);
        if (r && m.orderShortId && m.orderNumber != null) {
          r = r.replace(m.orderShortId, formatOrderNumber(m.orderNumber));
        }
        return r || undefined;
      },
      render: (m) => {
        let r = formatMovementReasonForDisplay(m.reason);
        if (r && m.orderShortId && m.orderNumber != null) {
          r = r.replace(m.orderShortId, formatOrderNumber(m.orderNumber));
        }
        return r || '—';
      },
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
  let reasonDisplay = formatMovementReasonForDisplay(movement.reason);
  if (reasonDisplay && movement.orderShortId && movement.orderNumber != null) {
    reasonDisplay = reasonDisplay.replace(movement.orderShortId, formatOrderNumber(movement.orderNumber));
  }
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
                      orderNumber={movement.orderNumber}
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

interface ShipmentOption {
  id: string;
  referenceNumber: number;
  label: string | null;
  destinationName: string | null;
  verifiedAt: string | null;
}

export interface LogisticsProviderDetailPageProps {
  provider: LogisticsProviderDetailRecord;
  locations: Location[];
  performance: LogisticsProviderRow | null;
  backHref: string;
  movementsData: MovementsData;
  productFilter: string | null;
  locationFilter: string | null;
  shipmentFilter: string | null;
  productBreakdown: { productId: string; productName: string; received: number; sold: number; available: number; reserved: number; transferredOut: number; adjusted: number; writtenOff: number; dispatched: number; qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string }[];
  locationBreakdown: { locationId: string; locationName: string; available: number; reserved: number; received: number; sold: number; transferredOut: number; adjusted: number; writtenOff: number; dispatched: number; qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string }[];
  shipments: ShipmentOption[];
  dateFilters?: { startDate: string | null; endDate: string | null; periodAllTime: boolean };
}

// ── Main component ───────────────────────────────────────────────────────────

export function LogisticsProviderDetailPage({
  provider,
  locations,
  performance,
  backHref,
  movementsData,
  productFilter,
  locationFilter,
  shipmentFilter,
  productBreakdown,
  locationBreakdown,
  shipments,
  dateFilters,
}: LogisticsProviderDetailPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const loaderRefetchBusy = useLoaderRefetchBusy({ samePathnameOnly: true }).busy;
  const [selectedMovement, setSelectedMovement] = useState<MovementWithProduct | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [detailTab, setDetailTab] = useState<'inventory' | 'movements'>('inventory');
  const [reportModal, setReportModal] = useState<{ name: string; row: StockBreakdownRow & { qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string } } | null>(null);
  const [reportView, setReportView] = useState<'summary' | 'breakdown'>('summary');

  // Aggregate stock totals from location breakdown for Performance strip
  const totalReceived = locationBreakdown.reduce((acc, l) => acc + l.received, 0);
  const totalAvailable = locationBreakdown.reduce((acc, l) => acc + l.available, 0);
  const totalSold = locationBreakdown.reduce((acc, l) => acc + l.sold, 0);
  const totalTransferredOut = locationBreakdown.reduce((acc, l) => acc + l.transferredOut, 0);
  const totalAdjusted = locationBreakdown.reduce((acc, l) => acc + l.adjusted, 0);
  const totalWrittenOff = locationBreakdown.reduce((acc, l) => acc + l.writtenOff, 0);
  const totalDispatched = locationBreakdown.reduce((acc, l) => acc + l.dispatched, 0);
  const totalReserved = locationBreakdown.reduce((acc, l) => acc + l.reserved, 0);

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

  const handleShipmentFilter = useCallback(
    (shipmentId: string) => {
      const next = new URLSearchParams(searchParams);
      if (shipmentId) {
        next.set('shipmentId', shipmentId);
      } else {
        next.delete('shipmentId');
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const filteredMovements = useMemo(() => {
    if (direction === 'all') return movementsData.movements;
    return movementsData.movements.filter((m) => classifyMovement(m) === direction);
  }, [movementsData.movements, direction]);

  const rateCardJson =
    provider.rateCard != null && typeof provider.rateCard === 'object'
      ? JSON.stringify(provider.rateCard, null, 2)
      : null;

  const cols = useMemo(() => movementColumns(setSelectedMovement), []);

  return (
    <div className="space-y-4 w-full min-w-0">
      <PageHeader
        title={provider.name}
        backTo={backHref}
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={provider.status} />
            <span className="text-app-fg-muted">{provider.locationCount} location{provider.locationCount === 1 ? '' : 's'}</span>
            {provider.contactInfo?.trim() && (
              <span className="text-app-fg-muted">Contact <span className="font-medium text-app-fg">{provider.contactInfo.trim()}</span></span>
            )}
            {provider.coverageArea?.trim() && (
              <span className="text-app-fg-muted">Coverage <span className="font-medium text-app-fg">{provider.coverageArea.trim()}</span></span>
            )}
          </span>
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Provider toolbar"
            saveFilterKey
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const totals = {
                      received: totalReceived,
                      sold: totalSold,
                      transferredOut: totalTransferredOut,
                      adjusted: totalAdjusted,
                      writtenOff: totalWrittenOff,
                      dispatched: totalDispatched,
                      reserved: totalReserved,
                      available: totalAvailable,
                      qtyRemitted: locationBreakdown.reduce((a, l) => a + l.qtyRemitted, 0),
                      qtyPending: locationBreakdown.reduce((a, l) => a + l.qtyPending, 0),
                      amountRemitted: String(locationBreakdown.reduce((a, l) => a + (parseFloat(l.amountRemitted) || 0), 0)),
                      amountPending: String(locationBreakdown.reduce((a, l) => a + (parseFloat(l.amountPending) || 0), 0)),
                    };
                    setReportModal({ name: `${provider.name} (All Locations)`, row: totals });
                  }}
                >
                  View report
                </Button>
                {shipments.length > 0 && (
                  <FormSelect
                    value={shipmentFilter ?? ''}
                    onChange={(e) => handleShipmentFilter(e.target.value)}
                    className="w-56"
                  >
                    <option value="">All shipments</option>
                    {shipments.map((s) => (
                      <option key={s.id} value={s.id}>
                        SHIP-{String(s.referenceNumber).padStart(4, '0')}{s.label ? ` · ${s.label}` : ''}{s.destinationName ? ` → ${s.destinationName}` : ''}
                      </option>
                    ))}
                  </FormSelect>
                )}
              </div>
            }
            sheet={({ closeSheet }) => (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    closeSheet();
                    const totals = {
                      received: totalReceived,
                      sold: totalSold,
                      transferredOut: totalTransferredOut,
                      adjusted: totalAdjusted,
                      writtenOff: totalWrittenOff,
                      dispatched: totalDispatched,
                      reserved: totalReserved,
                      available: totalAvailable,
                      qtyRemitted: locationBreakdown.reduce((a, l) => a + l.qtyRemitted, 0),
                      qtyPending: locationBreakdown.reduce((a, l) => a + l.qtyPending, 0),
                      amountRemitted: String(locationBreakdown.reduce((a, l) => a + (parseFloat(l.amountRemitted) || 0), 0)),
                      amountPending: String(locationBreakdown.reduce((a, l) => a + (parseFloat(l.amountPending) || 0), 0)),
                    };
                    setReportModal({ name: `${provider.name} (All Locations)`, row: totals });
                  }}
                >
                  View report
                </Button>
                {shipments.length > 0 && (
                  <FormSelect
                    value={shipmentFilter ?? ''}
                    onChange={(e) => { handleShipmentFilter(e.target.value); closeSheet(); }}
                    className="w-full"
                  >
                    <option value="">All shipments</option>
                    {shipments.map((s) => (
                      <option key={s.id} value={s.id}>
                        SHIP-{String(s.referenceNumber).padStart(4, '0')}{s.label ? ` · ${s.label}` : ''}
                      </option>
                    ))}
                  </FormSelect>
                )}
              </div>
            )}
          />
        }
      />

      <DateFilterBar
        startDate={dateFilters?.startDate ?? undefined}
        endDate={dateFilters?.endDate ?? undefined}
        periodAllTime={dateFilters?.periodAllTime}
        chrome="pill"
      />

      {shipments.length > 0 && (
        <div className="md:hidden">
          <FormSelect
            value={shipmentFilter ?? ''}
            onChange={(e) => handleShipmentFilter(e.target.value)}
            className="w-full"
          >
            <option value="">All shipments</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                SHIP-{String(s.referenceNumber).padStart(4, '0')}{s.label ? ` · ${s.label}` : ''}
              </option>
            ))}
          </FormSelect>
        </div>
      )}

      {performance ? (
        <div>
          <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">Performance</h2>
          <OverviewStatStrip
            mobileGrid
            tileClassName="!py-3.5 !px-4 min-w-[9rem]"
            items={[
              {
                label: 'Received',
                value: (<span className="font-semibold text-app-fg tabular-nums">{(totalReceived + totalAdjusted).toLocaleString()}</span>),
                plainValue: true,
                title: 'Total units received at this provider (net of reconciliations)',
              },
              {
                label: 'Available',
                value: (<span className={`font-semibold tabular-nums ${totalAvailable === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{totalAvailable.toLocaleString()}</span>),
                plainValue: true,
                title: 'Current available stock across all locations',
              },
              {
                label: 'Sold',
                value: (<span className="font-semibold text-brand-600 dark:text-brand-400 tabular-nums">{totalSold.toLocaleString()}</span>),
                plainValue: true,
                title: 'Total units sold via delivery movements',
              },
              {
                label: 'Transferred out',
                value: (<span className={`font-semibold tabular-nums ${totalTransferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{totalTransferredOut > 0 ? '−' : ''}{totalTransferredOut.toLocaleString()}</span>),
                plainValue: true,
                title: 'Units transferred out to other providers/locations',
              },
              {
                label: 'Reserved',
                value: (<span className={`font-semibold tabular-nums ${totalReserved > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{totalReserved.toLocaleString()}</span>),
                plainValue: true,
                title: 'Units reserved for confirmed orders (not yet delivered)',
              },
              {
                label: 'Delivered',
                value: (
                  <DualValue
                    className="font-semibold"
                    left={<span className="text-app-fg">{performance.delivered.toLocaleString()}</span>}
                    right={<span className={deliveryRateColorClass(performance.deliveryRate)}>{performance.totalAssigned > 0 ? `${Math.round(performance.deliveryRate)}%` : '0%'}</span>}
                  />
                ),
                plainValue: true,
                title: `${performance.delivered.toLocaleString()} delivered of ${performance.totalAssigned.toLocaleString()} assigned`,
              },
              {
                label: 'Delinquency',
                value: (() => {
                  const delinquentCount = performance.returned + performance.partiallyDelivered + performance.writtenOff;
                  return (
                    <DualValue
                      className="font-semibold"
                      left={<span className="text-app-fg">{delinquentCount.toLocaleString()}</span>}
                      right={<span className={delinquencyRateColorClass(performance.delinquencyRate)}>{performance.totalAssigned > 0 ? `${Math.round(performance.delinquencyRate)}%` : '0%'}</span>}
                    />
                  );
                })(),
                plainValue: true,
                title: `Returned + partial + write-off of ${performance.totalAssigned.toLocaleString()} assigned`,
              },
              {
                label: 'Remitted',
                value: (<span className="font-semibold text-success-600 dark:text-success-400 tabular-nums">{formatNaira(performance.remittedAmount)}</span>),
                plainValue: true,
              },
              {
                label: 'Pending',
                value: (<span className={`font-semibold tabular-nums ${Number(performance.pendingRemittanceAmount) > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted'}`}>{formatNaira(performance.pendingRemittanceAmount)}</span>),
                plainValue: true,
              },
              {
                label: 'Disputed',
                value: (<span className={`font-semibold tabular-nums ${Number(performance.disputedRemittanceAmount) > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted'}`}>{formatNaira(performance.disputedRemittanceAmount)}</span>),
                plainValue: true,
              },
            ]}
          />
        </div>
      ) : null}

      <FilterPills
        value={detailTab}
        onChange={(v) => setDetailTab(v as 'inventory' | 'movements')}
        options={[
          { value: 'inventory', label: 'Inventory' },
          { value: 'movements', label: `Activities (${movementsData.total})` },
        ]}
      />

      {detailTab === 'inventory' && (<>
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">Locations</h2>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
          {locationBreakdown.map((l) => {
            const lc = checkConsistency(l);
            return (
            <div key={l.locationId} className="rounded-lg border border-app-border bg-app-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">{l.locationName}</p>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${lc.isConsistent ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`}>
                  {lc.isConsistent ? '✓ Balanced' : `✗ ${Math.abs(lc.diff).toLocaleString()} off`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums min-w-0">
                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Received</span> <span className="font-semibold text-app-fg">{(l.received + l.adjusted).toLocaleString()}</span></span>
                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Sold</span> <span className={`font-semibold ${l.sold > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg-muted'}`}>{l.sold.toLocaleString()}</span></span>
                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Transferred</span> <span className={`font-semibold ${l.transferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{l.transferredOut > 0 ? '−' : ''}{l.transferredOut.toLocaleString()}</span></span>
                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Available</span> <span className={`font-semibold ${l.available === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{l.available.toLocaleString()}</span></span>

                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Reserved</span> <span className={`font-semibold ${l.reserved > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{l.reserved.toLocaleString()}</span></span>
                <span className="flex items-baseline gap-1 text-micro font-normal min-w-0 sm:col-span-2"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Remitted</span> <span className={`font-semibold ${l.qtyRemitted > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}`}>{l.qtyRemitted.toLocaleString()}</span> <span className={l.qtyRemitted > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}>({formatNaira(l.amountRemitted)})</span>{l.qtyPending > 0 && <><span className="text-app-fg-muted text-[0.6em] mx-1">●</span><span className="font-semibold text-warning-600 dark:text-warning-400">{l.qtyPending.toLocaleString()}</span> <span className="text-warning-600 dark:text-warning-400">({formatNaira(l.amountPending)}) pending</span></>}</span>
                {l.qtyAwaitingRemittance > 0 && <span className="flex items-baseline gap-1 text-micro font-normal min-w-0 sm:col-span-2"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Awaiting</span> <span className="font-semibold text-danger-600 dark:text-danger-400">{l.qtyAwaitingRemittance.toLocaleString()} delivered — no remittance yet ({formatNaira(l.amountAwaitingRemittance)})</span></span>}
              </div>
              <button
                type="button"
                className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
                onClick={() => setReportModal({ name: l.locationName, row: l })}
              >
                View report
              </button>
            </div>
            );
          })}
        </div>
      </div>

      {productBreakdown.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">Product Analysis</h2>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
            {productBreakdown.map((p) => {
              const pc = checkConsistency(p);
              return (
              <div key={p.productId} className="rounded-lg border border-app-border bg-app-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">{p.productName}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pc.isConsistent ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`}>
                    {pc.isConsistent ? '✓ Balanced' : `✗ ${Math.abs(pc.diff).toLocaleString()} off`}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums min-w-0">
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Received</span> <span className="font-semibold text-app-fg">{(p.received + p.adjusted).toLocaleString()}</span></span>
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Sold</span> <span className={`font-semibold ${p.sold > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg-muted'}`}>{p.sold.toLocaleString()}</span></span>
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Transferred</span> <span className={`font-semibold ${p.transferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{p.transferredOut > 0 ? '−' : ''}{p.transferredOut.toLocaleString()}</span></span>
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Available</span> <span className={`font-semibold ${p.available === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{p.available.toLocaleString()}</span></span>
                  {p.dispatched > 0 && <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Dispatched</span> <span className="font-semibold text-warning-600 dark:text-warning-400">{p.dispatched.toLocaleString()}</span></span>}
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Reserved</span> <span className={`font-semibold ${p.reserved > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{p.reserved.toLocaleString()}</span></span>
                  <span className="flex items-baseline gap-1 text-micro font-normal min-w-0 sm:col-span-2"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Remitted</span> <span className={`font-semibold ${p.qtyRemitted > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}`}>{p.qtyRemitted.toLocaleString()}</span> <span className={p.qtyRemitted > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}>({formatNaira(p.amountRemitted)})</span>{p.qtyPending > 0 && <><span className="text-app-fg-muted text-[0.6em] mx-1">●</span><span className="font-semibold text-warning-600 dark:text-warning-400">{p.qtyPending.toLocaleString()}</span> <span className="text-warning-600 dark:text-warning-400">({formatNaira(p.amountPending)}) pending</span></>}</span>
                  {p.qtyAwaitingRemittance > 0 && <span className="flex items-baseline gap-1 text-micro font-normal min-w-0 sm:col-span-2"><span className="text-app-fg-muted w-[4.5rem] shrink-0">Awaiting</span> <span className="font-semibold text-danger-600 dark:text-danger-400">{p.qtyAwaitingRemittance.toLocaleString()} delivered — no remittance yet ({formatNaira(p.amountAwaitingRemittance)})</span></span>}
                </div>
                <button
                  type="button"
                  className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
                  onClick={() => setReportModal({ name: p.productName, row: p })}
                >
                  View report
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {rateCardJson ? (
        <div>
          <p className="text-xs font-medium text-app-fg-muted mb-2">Rate card (reference)</p>
          <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-x-auto max-h-48 text-app-fg">
            {rateCardJson}
          </pre>
        </div>
      ) : null}
      </>)}

      {detailTab === 'movements' && (
      <TableLoadingOverlay show={loaderRefetchBusy} minHeightClassName="min-h-[16rem]">
        <div className="space-y-4">
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
                pageSizeParam="movementsPerPage"
              />
            </div>
          )}
        </div>
      </TableLoadingOverlay>
      )}

      <MovementDetailModal
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />

      {reportModal && (() => {
        const r = reportModal.row;
        const c = checkConsistency(r);
        const dateStr = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        return (
        <Modal open onClose={() => { setReportModal(null); setReportView('summary'); }} contentClassName="p-0 flex flex-col" maxWidth="max-w-md">
          <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h2>
              <p className="text-xs text-app-fg-muted mt-0.5">{provider.name} — {reportModal.name}</p>
            </div>
            <button type="button" onClick={() => { setReportModal(null); setReportView('summary'); }} className="text-app-fg-muted hover:text-app-fg mt-0.5"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg></button>
          </div>
          <div className="px-5 pt-3 pb-1 shrink-0">
            <FilterPills value={reportView} onChange={(v) => setReportView(v as 'summary' | 'breakdown')} options={[{ value: 'summary', label: 'Summary' }, { value: 'breakdown', label: 'Breakdown' }]} />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
            {reportView === 'summary' ? (
              <pre className="text-xs font-mono bg-app-hover/40 rounded-lg p-5 whitespace-pre-wrap text-app-fg leading-relaxed">{generateStockReport(reportModal.name, r, provider.name)}</pre>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Stock Flow</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Received</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{(r.received + r.adjusted).toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Sold (Delivered)</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums text-brand-600 dark:text-brand-400">{r.sold.toLocaleString()}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Transferred Out</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${r.transferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{r.transferredOut > 0 ? '−' : ''}{r.transferredOut.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Reserved</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${r.reserved > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{r.reserved.toLocaleString()}</td></tr>
                  </tbody></table></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Balance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Expected Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{c.expectedAvailable.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Actual Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{r.available.toLocaleString()}</td></tr>
                    {!c.isConsistent && <tr className="bg-danger-50 dark:bg-danger-900/10"><td className="px-4 py-2.5 text-danger-700 dark:text-danger-400 font-medium">Discrepancy</td><td className="px-4 py-2.5 text-right font-bold text-danger-700 dark:text-danger-400 tabular-nums">{c.diff > 0 ? '+' : ''}{c.diff.toLocaleString()}</td></tr>}
                  </tbody></table></div>
                  <div className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm ${c.isConsistent ? 'bg-success-50 dark:bg-success-900/10 text-success-800 dark:text-success-300' : 'bg-danger-50 dark:bg-danger-900/10 text-danger-800 dark:text-danger-300'}`}>
                    <span className="text-base mt-0.5">{c.isConsistent ? '✓' : '✗'}</span>
                    <div>
                      {c.isConsistent ? <p>All stock is accounted for.</p> : <><p><strong>{Math.abs(c.diff).toLocaleString()}</strong> {c.diff > 0 ? 'more' : 'fewer'} units than expected.</p><button type="button" onClick={() => { setReportModal(null); setReportView('summary'); setDetailTab('movements'); }} className="mt-1.5 text-brand-600 dark:text-brand-400 text-xs font-medium hover:underline">View stock movements →</button></>}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Remittance Status</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Remitted</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums"><span className={r.qtyRemitted > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}>{r.qtyRemitted.toLocaleString()} units ({formatNaira(r.amountRemitted)})</span></td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Pending</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums"><span className={r.qtyPending > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted'}>{r.qtyPending.toLocaleString()} units ({formatNaira(r.amountPending)})</span></td></tr>
                    {r.qtyAwaitingRemittance > 0 && <tr className="bg-danger-50 dark:bg-danger-900/10"><td className="px-4 py-2.5 text-danger-700 dark:text-danger-400 font-medium">Awaiting</td><td className="px-4 py-2.5 text-right font-semibold text-danger-700 dark:text-danger-400 tabular-nums">{r.qtyAwaitingRemittance.toLocaleString()} delivered — no remittance yet ({formatNaira(r.amountAwaitingRemittance)})</td></tr>}
                  </tbody></table></div>
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t border-app-border flex justify-end gap-2 shrink-0">
            <Button type="button" variant="secondary" onClick={() => { setReportModal(null); setReportView('summary'); }}>Close</Button>
            <Button type="button" variant="primary" onClick={() => { const safeName = reportModal.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-'); downloadReport(`stock-report-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`, generateStockReport(reportModal.name, r, provider.name)); }}>Download report</Button>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}
