import { useMemo, useState } from 'react';
import { Form, Link, useFetcher, useNavigation } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import {
  applyOptimisticPatches,
  isOptimisticPatched,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { DescriptionList } from '~/components/ui/description-list';
import { Modal } from '~/components/ui/modal';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormField } from '~/components/ui/form-field';
import { useFetcherToast } from '~/components/ui/toast';
import type { ShipmentDetail, ShipmentStatus } from './types';
import { SHIPMENT_STATUS_VARIANT, formatShipmentStatus } from './types';

interface ShipmentDetailPageProps {
  data: ShipmentDetail;
  actionUrl: string;
}

interface LineDraft {
  receivedQuantity: string;
  varianceReason: string;
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

const TIMELINE_ORDER: ShipmentStatus[] = ['CREATED', 'IN_TRANSIT', 'ARRIVED', 'VERIFIED', 'CLOSED'];

function isStatusReached(current: ShipmentStatus, target: ShipmentStatus): boolean {
  if (current === 'CANCELLED') return target === 'CREATED';
  return TIMELINE_ORDER.indexOf(current) >= TIMELINE_ORDER.indexOf(target);
}

export function ShipmentDetailPage({ data, actionUrl }: ShipmentDetailPageProps) {
  const { shipment, lines, summary, stockDistribution, allowedTransitions } = data;
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const navigation = useNavigation();

  const [confirmInTransit, setConfirmInTransit] = useState(false);
  const [confirmArrived, setConfirmArrived] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const shipmentModalOpen =
    confirmInTransit || confirmArrived || confirmClose || verifyOpen || cancelOpen;
  useFetcherToast(fetcher.data, { successMessage: 'Shipment updated', skipErrorToast: shipmentModalOpen });

  const [verifyDrafts, setVerifyDrafts] = useState<Record<string, LineDraft>>(() => {
    const out: Record<string, LineDraft> = {};
    for (const line of lines) {
      out[line.id] = {
        receivedQuantity: String(line.expectedQuantity),
        varianceReason: '',
      };
    }
    return out;
  });

  useCloseOnFetcherSuccess(fetcher, () => {
    setConfirmInTransit(false);
    setConfirmArrived(false);
    setConfirmClose(false);
    setVerifyOpen(false);
    setCancelOpen(false);
    setCancelReason('');
  });

  const inFlightIntent = fetcher.formData?.get('intent')?.toString();
  const isBusy = fetcher.state !== 'idle';
  const isPending = (intent: string) => isBusy && inFlightIntent === intent;

  // Optimistic status flip while a transition is in flight.
  const statusPatches = useOptimisticListPatches<{ id: string; status: ShipmentStatus }>(
    fetcher,
    (fd, intent) => {
      if (intent === 'shipmentMarkInTransit') {
        return [{ id: shipment.id, patch: { status: 'IN_TRANSIT' } }];
      }
      if (intent === 'shipmentMarkArrived') {
        return [{ id: shipment.id, patch: { status: 'ARRIVED' } }];
      }
      if (intent === 'verifyShipment') {
        return [{ id: shipment.id, patch: { status: 'VERIFIED' } }];
      }
      if (intent === 'closeShipment') {
        return [{ id: shipment.id, patch: { status: 'CLOSED' } }];
      }
      if (intent === 'shipmentCancel') {
        return [{ id: shipment.id, patch: { status: 'CANCELLED' } }];
      }
      return null;
    },
  );
  const [displayShipment] = applyOptimisticPatches([shipment], statusPatches);
  const optimisticBusy = isOptimisticPatched(statusPatches, shipment.id);
  const status = displayShipment?.status ?? shipment.status;

  const allow = (token: string) => allowedTransitions.includes(token);

  const linesWithDraft = useMemo(
    () =>
      lines.map((line) => {
        const draft = verifyDrafts[line.id];
        return { line, draft };
      }),
    [lines, verifyDrafts],
  );

  // Live landing-cost preview during verify
  const livePreview = useMemo(() => {
    const total = parseFloat(shipment.totalLandingCost) || 0;
    const enriched = linesWithDraft.map(({ line, draft }) => {
      const received = Math.max(0, Number(draft?.receivedQuantity ?? '0') || 0);
      const factory = parseFloat(line.factoryCost) || 0;
      return { lineId: line.id, received, factory, weight: received * factory };
    });
    const valueSum = enriched.reduce((a, b) => a + b.weight, 0);
    if (total <= 0) return new Map(enriched.map((e) => [e.lineId, 0]));
    if (valueSum > 0) {
      let allocated = 0;
      const map = new Map<string, number>();
      enriched.forEach((row, idx) => {
        if (idx === enriched.length - 1) {
          map.set(row.lineId, Math.round((total - allocated) * 100) / 100);
        } else {
          const slice = Math.round(((row.weight / valueSum) * total) * 100) / 100;
          map.set(row.lineId, slice);
          allocated += slice;
        }
      });
      return map;
    }
    const qtySum = enriched.reduce((a, b) => a + b.received, 0);
    if (qtySum <= 0) return new Map(enriched.map((e) => [e.lineId, 0]));
    let allocated = 0;
    const map = new Map<string, number>();
    enriched.forEach((row, idx) => {
      if (idx === enriched.length - 1) {
        map.set(row.lineId, Math.round((total - allocated) * 100) / 100);
      } else {
        const slice = Math.round(((row.received / qtySum) * total) * 100) / 100;
        map.set(row.lineId, slice);
        allocated += slice;
      }
    });
    return map;
  }, [linesWithDraft, shipment.totalLandingCost]);

  // Validate verify form: every line needs a number ≥ 0; any mismatch needs a reason.
  const verifyReady = useMemo(() => {
    if (lines.length === 0) return false;
    for (const line of lines) {
      const draft = verifyDrafts[line.id];
      if (!draft) return false;
      const num = Number(draft.receivedQuantity);
      if (!Number.isFinite(num) || num < 0) return false;
      if (num !== line.expectedQuantity && draft.varianceReason.trim().length === 0) {
        return false;
      }
    }
    return true;
  }, [lines, verifyDrafts]);

  const submit = (intent: string, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('shipmentId', shipment.id);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    }
    fetcher.submit(fd, { method: 'post', action: actionUrl });
  };

  const submitVerify = () => {
    const lineReceipts = lines.map((line) => {
      const draft = verifyDrafts[line.id]!;
      return {
        lineId: line.id,
        receivedQuantity: Number(draft.receivedQuantity),
        varianceReason:
          Number(draft.receivedQuantity) === line.expectedQuantity
            ? ''
            : draft.varianceReason.trim(),
      };
    });
    submit('verifyShipment', { lines: JSON.stringify(lineReceipts) });
  };

  const lineColumns = useMemo<CompactTableColumn<ShipmentDetail['lines'][number]>[]>(
    () => [
      {
        key: 'product',
        header: 'Product',
        render: (l) => (
          <span className="text-sm font-medium text-app-fg">{l.productName ?? l.productId.slice(0, 8)}</span>
        ),
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        render: () => (
          <Link
            to={`/admin/inventory?locationId=${shipment.destinationLocationId}`}
            className="text-sm text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400 dark:hover:text-brand-300"
          >
            {shipment.destinationLocationName ?? '—'}
          </Link>
        ),
      },
      {
        key: 'expected',
        header: 'Expected',
        align: 'right',
        nowrap: true,
        render: (l) => <span className="tabular-nums">{l.expectedQuantity}</span>,
      },
      {
        key: 'received',
        header: 'Received',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums">
            {l.receivedQuantity != null ? l.receivedQuantity : <span className="text-app-fg-muted">—</span>}
          </span>
        ),
      },
      {
        key: 'remaining',
        header: 'Remaining',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums">
            {l.batchRemainingQuantity != null ? l.batchRemainingQuantity : <span className="text-app-fg-muted">—</span>}
          </span>
        ),
      },
      {
        key: 'consumed',
        header: 'Consumed',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums">
            {l.consumedQuantity != null ? l.consumedQuantity : <span className="text-app-fg-muted">—</span>}
          </span>
        ),
      },
      {
        key: 'reserved',
        header: 'Reserved',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums text-warning-600 dark:text-warning-400">
            {l.currentReservedCount != null ? l.currentReservedCount : <span className="text-app-fg-muted">—</span>}
          </span>
        ),
      },
      {
        key: 'factory',
        header: 'Factory cost',
        align: 'right',
        nowrap: true,
        render: (l) => <span className="text-app-fg-muted tabular-nums">{formatNaira(l.factoryCost)}</span>,
      },
      {
        key: 'landing',
        header: 'Allocated landing',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="text-app-fg-muted tabular-nums">
            {l.allocatedLandingCost != null ? formatNaira(l.allocatedLandingCost) : '—'}
          </span>
        ),
      },
      {
        key: 'variance',
        header: 'Variance',
        render: (l) => (
          <span className="text-xs text-app-fg-muted">{l.varianceReason ?? '—'}</span>
        ),
      },
    ],
    [shipment.destinationLocationId, shipment.destinationLocationName],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={shipment.referenceLabel}
        backTo="/admin/shipments"
        mobileInlineActions
        description={shipment.label ?? undefined}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Shipment toolbar"
            mobileLeading={
              <StatusBadge
                status={status}
                label={formatShipmentStatus(status)}
                variant={SHIPMENT_STATUS_VARIANT[status]}
              />
            }
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={status}
                  label={formatShipmentStatus(status)}
                  variant={SHIPMENT_STATUS_VARIANT[status]}
                />
                <PageRefreshButton />
                {(status === 'VERIFIED' || status === 'CLOSED') ? (
                  <Link
                    to={`/admin/inventory?shipmentId=${shipment.id}`}
                    prefetch="intent"
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-transparent bg-brand-500 text-sm font-medium text-white shadow-sm hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    View shipment stock
                  </Link>
                ) : null}
                {allow('EDIT_LINES') ? (
                  <Link
                    to={`/admin/shipments/${shipment.id}/edit`}
                    prefetch="intent"
                    className="btn-secondary btn-sm"
                  >
                    Edit details
                  </Link>
                ) : null}
                {allow('MARK_IN_TRANSIT') ? (
                  <Button variant="secondary" size="sm" disabled={optimisticBusy} onClick={() => setConfirmInTransit(true)}>
                    Mark in transit
                  </Button>
                ) : null}
                {allow('MARK_ARRIVED') ? (
                  <Button variant="secondary" size="sm" disabled={optimisticBusy} onClick={() => setConfirmArrived(true)}>
                    Mark arrived
                  </Button>
                ) : null}
                {allow('VERIFY') ? (
                  <Button variant="primary" size="sm" disabled={optimisticBusy} onClick={() => setVerifyOpen(true)}>
                    Verify and receive
                  </Button>
                ) : null}
                {allow('CLOSE') ? (
                  <Button variant="primary" size="sm" disabled={optimisticBusy} onClick={() => setConfirmClose(true)}>
                    Close shipment
                  </Button>
                ) : null}
                {allow('CANCEL') ? (
                  <Button variant="danger" size="sm" disabled={optimisticBusy} onClick={() => setCancelOpen(true)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            }
            sheet={
              <>
                {(status === 'VERIFIED' || status === 'CLOSED') ? (
                  <Link to={`/admin/inventory?shipmentId=${shipment.id}`} prefetch="intent" className="btn-secondary btn-sm w-full justify-center">
                    View shipment stock
                  </Link>
                ) : null}
                {allow('EDIT_LINES') ? (
                  <Link
                    to={`/admin/shipments/${shipment.id}/edit`}
                    prefetch="intent"
                    className="btn-secondary btn-sm w-full justify-center"
                  >
                    Edit details
                  </Link>
                ) : null}
                {allow('MARK_IN_TRANSIT') ? (
                  <Button variant="secondary" size="sm" className="w-full justify-center" disabled={optimisticBusy} onClick={() => setConfirmInTransit(true)}>
                    Mark in transit
                  </Button>
                ) : null}
                {allow('MARK_ARRIVED') ? (
                  <Button variant="secondary" size="sm" className="w-full justify-center" disabled={optimisticBusy} onClick={() => setConfirmArrived(true)}>
                    Mark arrived
                  </Button>
                ) : null}
                {allow('VERIFY') ? (
                  <Button variant="primary" size="sm" className="w-full justify-center" disabled={optimisticBusy} onClick={() => setVerifyOpen(true)}>
                    Verify and receive
                  </Button>
                ) : null}
                {allow('CLOSE') ? (
                  <Button variant="primary" size="sm" className="w-full justify-center" disabled={optimisticBusy} onClick={() => setConfirmClose(true)}>
                    Close shipment
                  </Button>
                ) : null}
                {allow('CANCEL') ? (
                  <Button variant="danger" size="sm" className="w-full justify-center" disabled={optimisticBusy} onClick={() => setCancelOpen(true)}>
                    Cancel
                  </Button>
                ) : null}
              </>
            }
          />
        }
      />

      {/* Status timeline */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-app-fg-muted">
        {TIMELINE_ORDER.map((step, idx) => {
          const reached = isStatusReached(status, step);
          const isCurrent = step === status;
          return (
            <span key={step} className="flex items-center gap-2">
              <span
                className={[
                  'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-micro font-semibold',
                  reached
                    ? isCurrent
                      ? 'bg-brand-500 text-white'
                      : 'bg-success-500 text-white'
                    : 'bg-app-hover text-app-fg-muted',
                ].join(' ')}
              >
                {idx + 1}
              </span>
              <span className={isCurrent ? 'text-app-fg font-medium' : ''}>
                {formatShipmentStatus(step)}
              </span>
              {idx < TIMELINE_ORDER.length - 1 ? <span className="text-app-fg-muted/40">→</span> : null}
            </span>
          );
        })}
        {status === 'CANCELLED' ? (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-1 text-micro font-semibold text-danger-700 dark:bg-danger-900/30 dark:text-danger-300">
            Cancelled
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Shipment details" />
        <CardBody>
          <DescriptionList
            layout="grid"
            gridColumns={4}
            mobileColumns={2}
            dense
            items={[
              { label: 'Destination', value: shipment.destinationLocationName },
              { label: 'Supplier', value: shipment.supplierName },
              { label: 'Supplier ref', value: shipment.supplierReference, hideIfEmpty: true },
              { label: 'Landing cost', value: formatNaira(shipment.totalLandingCost) },
              { label: 'Expected arrival', value: formatDate(shipment.expectedArrivalAt) },
              { label: 'Arrived', value: formatDate(shipment.arrivedAt), hideIfEmpty: true },
              { label: 'Verified', value: formatDate(shipment.verifiedAt), hideIfEmpty: true },
              { label: 'Closed', value: formatDate(shipment.closedAt), hideIfEmpty: true },
              { label: 'Notes', value: shipment.notes, hideIfEmpty: true, fullWidth: true },
              ...(shipment.cancelledReason
                ? [
                    {
                      label: 'Cancelled reason',
                      value: <span className="whitespace-pre-wrap">{shipment.cancelledReason}</span>,
                      fullWidth: true,
                    },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Current shipment status" />
        <CardBody className="space-y-3">
          {summary.verifiedLineCount > 0 ? (
            <>
              <OverviewStatStrip
                mobileGrid
                embedded
                items={[
                  { label: 'Received', value: summary.totalReceived, valueClassName: 'text-app-fg' },
                  { label: 'Consumed', value: summary.consumedFromShipment, valueClassName: 'text-app-fg' },
                  { label: 'Remaining', value: summary.remainingFromShipment, valueClassName: 'text-brand-600 dark:text-brand-400' },
                  { label: 'Reserved', value: summary.currentReserved, valueClassName: 'text-warning-600 dark:text-warning-400' },
                ]}
              />
              <p className="text-xs text-app-fg-muted">
                Consumed and remaining are from this shipment's FIFO batches. Reserved = units held for confirmed orders at the destination warehouse.
              </p>
            </>
          ) : (
            <p className="text-sm text-app-fg-muted">
              This shipment has not been verified into inventory yet, so there is no live remaining-stock report to show.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Line items — card chrome is desktop-only; on mobile each row is
          already its own elevated card, so a wrapper would just waste width. */}
      <section className="md:rounded-xl md:border md:border-app-border md:bg-app-elevated md:p-4 md:shadow-card">
        <CardHeader title={`Line items (${lines.length})`} className="mb-2 md:mb-4" />
        <CompactTable
          columns={lineColumns}
          rows={lines}
          rowKey={(l) => l.id}
          emptyTitle="No line items on this shipment"
        />
      </section>

      {stockDistribution.length > 0 && (
        <Card>
          <CardHeader title="Stock distribution" />
          <CardBody>
            <CompactTable
              columns={[
                {
                  key: 'location',
                  header: 'Location',
                  render: (r) => (
                    <span>
                      {r.locationName}
                      {r.isDestination && (
                        <span className="ml-1.5 text-xs text-app-fg-muted">(destination)</span>
                      )}
                    </span>
                  ),
                },
                { key: 'stock', header: 'Stock', align: 'right' as const, render: (r) => <span className="tabular-nums">{r.stock}</span> },
                {
                  key: 'reserved',
                  header: 'Reserved',
                  align: 'right' as const,
                  render: (r) => (
                    <span className="tabular-nums text-warning-600 dark:text-warning-400">{r.reserved}</span>
                  ),
                },
                {
                  key: 'sold',
                  header: 'Sold',
                  align: 'right' as const,
                  render: (r) => <span className="tabular-nums">{r.sold}</span>,
                },
                {
                  key: 'available',
                  header: 'Available',
                  align: 'right' as const,
                  render: (r) => (
                    <span className="tabular-nums text-success-600 dark:text-success-400">{r.available}</span>
                  ),
                },
              ]}
              rows={stockDistribution}
              rowKey={(r) => r.locationId}
              emptyTitle="No stock at any location"
            />
            <p className="mt-2 text-xs text-app-fg-muted">
              Current stock of this shipment's products across all locations. Stock = total units on shelf. Available = stock minus reserved.
            </p>
          </CardBody>
        </Card>
      )}

      {fetcherSurface.rawError && !shipmentModalOpen ? (
        <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200">
          {fetcherSurface.friendlyError}
        </p>
      ) : null}

      <ConfirmActionModal
        open={confirmInTransit}
        onClose={() => setConfirmInTransit(false)}
        error={fetcherSurface.errorMatchingIntent('shipmentMarkInTransit')}
        title="Mark this shipment as in transit?"
        description="Use this after the supplier dispatches the goods."
        confirmLabel="Mark in transit"
        variant="warning"
        loading={isPending('shipmentMarkInTransit')}
        onConfirm={() => submit('shipmentMarkInTransit')}
      />

      <ConfirmActionModal
        open={confirmArrived}
        onClose={() => setConfirmArrived(false)}
        error={fetcherSurface.errorMatchingIntent('shipmentMarkArrived')}
        title="Mark this shipment as arrived?"
        description="Use this when the goods reach the destination and are ready to verify."
        confirmLabel="Mark arrived"
        variant="warning"
        loading={isPending('shipmentMarkArrived')}
        onConfirm={() => submit('shipmentMarkArrived')}
      />

      <ConfirmActionModal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        error={fetcherSurface.errorMatchingIntent('closeShipment')}
        title="Close this shipment?"
        description="Locks the shipment from any further edits — final audit point."
        confirmLabel="Close shipment"
        variant="warning"
        loading={isPending('closeShipment')}
        onConfirm={() => submit('closeShipment')}
      />

      <Modal open={verifyOpen} onClose={() => (isPending('verifyShipment') ? null : setVerifyOpen(false))} maxWidth="max-w-3xl">
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            if (verifyReady) submitVerify();
          }}
          className="space-y-4 p-5"
        >
          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('verifyShipment')} />
          <div>
            <h3 className="text-base font-semibold text-app-fg">Verify and receive shipment</h3>
            <p className="mt-0.5 text-sm text-app-fg-muted">
              Confirm received quantities for each line. Mismatches require a reason. On verify,
              every line writes a FIFO batch, updates inventory, and logs an INTAKE movement.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-app-border bg-app-elevated/40 p-3">
            {linesWithDraft.map(({ line, draft }) => {
              const draftQty = Number(draft?.receivedQuantity ?? '0') || 0;
              const mismatch = draftQty !== line.expectedQuantity;
              return (
                <div
                  key={line.id}
                  className="grid grid-cols-1 gap-2 rounded-md border border-app-border bg-app-card p-3 sm:grid-cols-12"
                >
                  <div className="sm:col-span-4">
                    <p className="text-sm font-medium text-app-fg">
                      {line.productName ?? line.productId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-app-fg-muted">
                      Expected: <span className="tabular-nums">{line.expectedQuantity}</span> · Factory{' '}
                      {formatNaira(line.factoryCost)}
                    </p>
                    <p className="text-xs text-app-fg-muted">
                      Allocated landing: <span className="tabular-nums">{formatNaira(livePreview.get(line.id))}</span>
                    </p>
                  </div>
                  <div className="sm:col-span-3">
                    <FormField label="Received qty">
                      <TextInput
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={draft?.receivedQuantity ?? ''}
                        onChange={(e) =>
                          setVerifyDrafts((prev) => ({
                            ...prev,
                            [line.id]: {
                              receivedQuantity: e.target.value,
                              varianceReason: prev[line.id]?.varianceReason ?? '',
                            },
                          }))
                        }
                      />
                    </FormField>
                  </div>
                  <div className="sm:col-span-5">
                    <FormField
                      label="Variance reason"
                      hint={mismatch ? 'Required when received differs from expected' : 'Optional'}
                    >
                      <TextInput
                        value={draft?.varianceReason ?? ''}
                        onChange={(e) =>
                          setVerifyDrafts((prev) => ({
                            ...prev,
                            [line.id]: {
                              receivedQuantity: prev[line.id]?.receivedQuantity ?? '',
                              varianceReason: e.target.value,
                            },
                          }))
                        }
                        maxLength={500}
                        placeholder="e.g. 2 units damaged in transit"
                      />
                    </FormField>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setVerifyOpen(false)}
              disabled={isPending('verifyShipment')}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!verifyReady || navigation.state === 'submitting'}
              loading={isPending('verifyShipment')}
            >
              Confirm receipts
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => (isPending('shipmentCancel') ? null : setCancelOpen(false))}
        aria-labelledby="cancel-shipment-title"
      >
        <div className="space-y-3 p-5">
          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('shipmentCancel')} />
          <h3 id="cancel-shipment-title" className="text-base font-semibold text-app-fg">
            Cancel this shipment?
          </h3>
          <p className="text-sm text-app-fg-muted">
            Cancelling voids the shipment with no inventory side effects. Use only before the goods
            have been verified into stock. This action is logged.
          </p>
          <FormField label="Reason" hint="Min 10 characters · saved on the shipment for audit">
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={500}
              autoFocus
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCancelOpen(false)}
              disabled={isPending('shipmentCancel')}
            >
              Keep shipment
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={isPending('shipmentCancel')}
              disabled={cancelReason.trim().length < 10}
              onClick={() => submit('shipmentCancel', { reason: cancelReason.trim() })}
            >
              Cancel shipment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
