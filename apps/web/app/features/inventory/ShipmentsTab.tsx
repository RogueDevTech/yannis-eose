import { useMemo } from 'react';
import { Link } from '@remix-run/react';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { isOptimisticId } from '~/lib/optimistic';
import type { ShipmentRow, ShipmentStatus } from './types';
import { SHIPMENT_STATUS_VARIANT, formatShipmentStatus } from './types';

interface ShipmentsTabProps {
  shipments: ShipmentRow[];
  totalShipments: number;
  canIntake: boolean;
}

function formatNaira(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : value ?? 0;
  if (!Number.isFinite(n)) return '₦0';
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { dateStyle: 'medium' });
}

export function ShipmentsTab({
  shipments,
  totalShipments,
  canIntake,
}: ShipmentsTabProps) {
  const display = shipments;

  const columns = useMemo<CompactTableColumn<ShipmentRow>[]>(
    () => [
      {
        key: 'reference',
        header: 'Reference',
        render: (s) => (
          <span className="font-mono text-sm font-medium text-app-fg truncate block">
            {s.referenceLabel}
          </span>
        ),
      },
      {
        key: 'supplier',
        header: 'Supplier',
        render: (s) => (
          <span className="text-sm text-app-fg truncate block">{s.supplierName ?? '—'}</span>
        ),
      },
      {
        key: 'destination',
        header: 'Destination',
        render: (s) => (
          <span className="text-sm text-app-fg-muted">{s.destinationLocationName ?? '—'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (s) => (
          <StatusBadge
            status={s.status}
            label={formatShipmentStatus(s.status)}
            variant={SHIPMENT_STATUS_VARIANT[s.status]}
          />
        ),
      },
      {
        key: 'eta',
        header: 'Expected',
        nowrap: true,
        render: (s) => <span className="text-sm text-app-fg-muted">{formatDate(s.expectedArrivalAt)}</span>,
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
      {
        key: 'landing',
        header: 'Landing',
        align: 'right',
        nowrap: true,
        render: (s) => (
          <span className="text-sm text-app-fg-muted tabular-nums">
            {formatNaira(s.totalLandingCost)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (s) =>
          isOptimisticId(s.id) ? (
            <TableActionButton inert variant="primary">
              View
            </TableActionButton>
          ) : (
            <TableActionButton
              to={`/admin/shipments/${s.id}`}
              prefetch="intent"
              variant="primary"
            >
              View
            </TableActionButton>
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      {/* "Receive shipment" moved to the page-header Action icon group. */}
      <div className="text-sm text-app-fg-muted">
        {totalShipments} shipment{totalShipments === 1 ? '' : 's'}
      </div>

      {display.length === 0 ? (
        <EmptyState
          variant="page"
          title="No shipments yet"
          description={
            canIntake
              ? 'Track incoming stock from suppliers — record planned shipments or log goods that already arrived.'
              : 'No inbound shipments have been recorded for your branch yet.'
          }
          action={
            canIntake ? (
              <Link to="/admin/shipments/receive" prefetch="intent" className="btn-primary btn-sm">
                Receive shipment
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CompactTable<ShipmentRow>
          columns={columns}
          rows={display}
          rowKey={(r) => r.id}
          rowClassName={(s) => (isOptimisticId(s.id) ? 'opacity-60' : '')}
          emptyTitle="No shipments yet"
        />
      )}
    </div>
  );
}
