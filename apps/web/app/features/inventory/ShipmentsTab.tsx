import { useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
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
  const [peekShipment, setPeekShipment] = useState<ShipmentRow | null>(null);
  const display = shipments;

  const columns = useMemo<CompactTableColumn<ShipmentRow>[]>(
    () => [
      {
        key: 'reference',
        header: 'Reference',
        hideable: false,
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
        hideable: false,
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
          columnVisibilityKey="admin.inventory.shipments"
          columns={columns}
          rows={display}
          rowKey={(r) => r.id}
          rowClassName={(s) => (isOptimisticId(s.id) ? 'opacity-60' : '')}
          emptyTitle="No shipments yet"
          renderMobileCard={(s) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-app-fg truncate">{s.referenceLabel}</span>
                  <StatusBadge
                    status={s.status}
                    label={formatShipmentStatus(s.status)}
                    variant={SHIPMENT_STATUS_VARIANT[s.status]}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-app-fg-muted truncate">
                  <span>{s.supplierName ?? '—'}</span>
                  <span className="text-app-fg-muted/50">→</span>
                  <span>{s.destinationLocationName ?? '—'}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums">
                  <span>{s.lineCount} line{s.lineCount === 1 ? '' : 's'} ({s.totalExpected} units)</span>
                  <span>{formatNaira(s.totalLandingCost)}</span>
                  {s.expectedArrivalAt ? <span>{formatDate(s.expectedArrivalAt)}</span> : null}
                </div>
              </>
            );
            if (isOptimisticId(s.id)) return body;
            return (
              <button
                type="button"
                onClick={() => setPeekShipment(s)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
              >
                {body}
              </button>
            );
          }}
        />
      )}

      {/* Peek modal — mobile card tap shows shipment details + actions */}
      {peekShipment && (
        <Modal
          open
          onClose={() => setPeekShipment(null)}
          maxWidth="max-w-sm"
          contentClassName="p-5 space-y-4 bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold font-mono text-app-fg leading-snug">
                {peekShipment.referenceLabel}
              </h3>
              <div className="mt-1">
                <StatusBadge
                  status={peekShipment.status}
                  label={formatShipmentStatus(peekShipment.status)}
                  variant={SHIPMENT_STATUS_VARIANT[peekShipment.status]}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPeekShipment(null)}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Key details */}
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-app-fg-muted">Supplier</dt>
              <dd className="font-medium text-app-fg text-right truncate">{peekShipment.supplierName ?? '—'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-app-fg-muted">Destination</dt>
              <dd className="font-medium text-app-fg text-right truncate">{peekShipment.destinationLocationName ?? '—'}</dd>
            </div>
            {peekShipment.expectedArrivalAt && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-app-fg-muted">Expected arrival</dt>
                <dd className="font-medium text-app-fg tabular-nums">{formatDate(peekShipment.expectedArrivalAt)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-app-fg-muted">Lines / units</dt>
              <dd className="font-medium text-app-fg tabular-nums">
                {peekShipment.lineCount} line{peekShipment.lineCount === 1 ? '' : 's'} ({peekShipment.totalExpected} units)
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-app-fg-muted">Landing cost</dt>
              <dd className="font-medium text-app-fg tabular-nums">{formatNaira(peekShipment.totalLandingCost)}</dd>
            </div>
          </dl>

          {/* Actions */}
          <div className="pt-2 border-t border-app-border">
            <Link
              to={`/admin/shipments/${peekShipment.id}`}
              prefetch="intent"
              className="btn-primary btn-sm w-full text-center inline-flex items-center justify-center"
              onClick={() => setPeekShipment(null)}
            >
              View details
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
