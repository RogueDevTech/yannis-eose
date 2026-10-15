import { useEffect, useMemo, useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { EmptyState } from '~/components/ui/empty-state';
import { InlineNotification } from '~/components/ui/inline-notification';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { formatOrderTimestamp } from '~/lib/format-date';
import {
  fetchCustomerJourney,
  type CustomerJourney,
  type CustomerJourneyEvent,
} from '~/lib/trpc-browser';

interface CustomerJourneyModalProps {
  orderId: string;
  onClose: () => void;
}

/** Consecutive views of the same form on the same website collapse into one row ("Opened form, 3 times"). */
type JourneyRow = CustomerJourneyEvent & { count: number; lastAt: string };

function collapseViews(events: CustomerJourneyEvent[]): JourneyRow[] {
  const out: JourneyRow[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (e.kind === 'VIEW' && prev?.kind === 'VIEW' && prev.formName === e.formName && prev.detail === e.detail) {
      prev.count += 1;
      prev.lastAt = e.at;
      continue;
    }
    out.push({ ...e, count: 1, lastAt: e.at });
  }
  return out;
}

const CART_STATUS_LABEL: Record<string, string> = {
  CONVERTED: 'became an order',
  ABANDONED: 'left without submitting',
  PENDING: 'still filling',
};

function rowTitle(r: JourneyRow): string {
  switch (r.kind) {
    case 'VIEW':
      return r.count > 1 ? `Opened form, ${r.count} times` : 'Opened form';
    case 'CART': {
      const s = r.status ? CART_STATUS_LABEL[r.status] : null;
      return s ? `Started filling the form, ${s}` : 'Started filling the form';
    }
    case 'FAILED_SUBMIT':
      return 'Submit did not go through';
    case 'ORDER':
      return r.isAnchor ? 'This order was created' : 'Order created';
    case 'CLEANUP':
      return 'Duplicate cleanup';
  }
}

const DOT_CLASS: Record<CustomerJourneyEvent['kind'], string> = {
  VIEW: 'bg-app-fg-muted/50',
  CART: 'bg-amber-500',
  FAILED_SUBMIT: 'bg-danger-500',
  ORDER: 'bg-success-500',
  CLEANUP: 'bg-warning-500',
};

function JourneyRowItem({ row }: { row: JourneyRow }) {
  const time =
    row.count > 1
      ? `${formatOrderTimestamp(row.at)} to ${formatOrderTimestamp(row.lastAt)}`
      : formatOrderTimestamp(row.at);
  return (
    <li className={`relative pl-5 py-2.5 ${row.isAnchor && row.kind === 'ORDER' ? 'rounded-md bg-brand-50 dark:bg-brand-900/20 -mx-2 px-2 pl-7' : ''}`}>
      <span
        aria-hidden
        className={`absolute top-4 h-2 w-2 rounded-full ${DOT_CLASS[row.kind]} ${row.isAnchor && row.kind === 'ORDER' ? 'left-2' : 'left-0'}`}
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-app-fg">{rowTitle(row)}</span>
        {row.orderId && row.orderNumber != null && (row.kind === 'ORDER' || row.kind === 'CLEANUP') && (
          <OrderIdBadge
            id={row.orderId}
            orderNumber={row.orderNumber}
            length={8}
            ellipsis="…"
            linkTo={`/admin/orders/${row.orderId}`}
            newTab
            textClassName="font-mono text-xs text-brand-600 dark:text-brand-400 hover:underline"
            className="inline-flex"
          />
        )}
        {row.kind === 'ORDER' && row.status && <OrderStatusBadge status={row.status} />}
        {!row.sameBrowser && (
          <span className="inline-flex items-center rounded-full border border-app-border px-1.5 py-0.5 text-micro font-medium text-app-fg-muted">
            Same phone, other browser
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-app-fg-muted">
        {time}
        {row.formName ? (
          <>
            {' · '}
            <span className="text-app-fg">{row.formName}</span>
            {row.mediaBuyerName ? ` (${row.mediaBuyerName})` : ''}
          </>
        ) : row.mediaBuyerName ? ` · ${row.mediaBuyerName}` : ''}
      </p>
      {row.kind === 'VIEW' && row.detail && (
        <p className="mt-0.5 text-xs text-app-fg-muted break-all">On {row.detail}</p>
      )}
      {row.kind === 'FAILED_SUBMIT' && row.detail && (
        <p className="mt-0.5 text-xs text-danger-600 dark:text-danger-400 break-words">{row.detail}</p>
      )}
      {row.kind === 'CLEANUP' && row.detail && (
        <p className="mt-0.5 text-xs text-app-fg-muted break-words">{row.detail}</p>
      )}
    </li>
  );
}

/**
 * Everything the same customer (phone) or browser (form session) did around
 * this order: forms opened, forms started, failed submits, orders and duplicate
 * cleanups. Answers "which form did this customer actually use?" in one look.
 */
export function CustomerJourneyModal({ orderId, onClose }: CustomerJourneyModalProps) {
  const [journey, setJourney] = useState<CustomerJourney | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setJourney(null);
    setError(null);
    fetchCustomerJourney(orderId)
      .then((j) => { if (!cancelled) setJourney(j); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the customer journey'); });
    return () => { cancelled = true; };
  }, [orderId]);

  const rows = useMemo(() => (journey ? collapseViews(journey.events) : []), [journey]);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-2xl"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
      aria-labelledby="customer-journey-title"
    >
      <div className="px-4 sm:px-5 py-4 border-b border-app-border">
        <h2 id="customer-journey-title" className="text-lg font-semibold text-app-fg">
          Customer journey
        </h2>
        <p className="text-xs mt-0.5 text-app-fg-muted">
          Same customer or browser, {journey?.windowDays ?? 14} days either side of this order.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-3">
        {error ? (
          <InlineNotification variant="danger" message={error} />
        ) : !journey ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing found" description="No activity matched this order." />
        ) : (
          <div className="space-y-3">
            {!journey.hasBrowserSession && (
              <InlineNotification
                variant="info"
                message="This order has no browser record (entered by staff, imported or older), so only matches on phone are shown."
              />
            )}
            {journey.truncated && (
              <InlineNotification variant="info" message="Showing the latest 300 events only." />
            )}
            <ol className="relative border-l border-app-border ml-1 pl-3">
              {rows.map((r, i) => (
                <JourneyRowItem key={`${r.kind}-${r.at}-${i}`} row={r} />
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 border-t border-app-border flex items-center justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
