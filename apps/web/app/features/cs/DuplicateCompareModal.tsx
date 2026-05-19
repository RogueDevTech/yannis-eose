import { Link } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { InlineNotification } from '~/components/ui/inline-notification';
import type { CSOrder, DuplicatePair } from './types';

interface DuplicateCompareModalProps {
  pair: DuplicatePair | null;
  onClose: () => void;
  /** Hand the pair back so the parent can open its existing Merge confirm modal. */
  onMerge: (pair: DuplicatePair) => void;
  /** Hand the pair back so the parent can open its existing Dismiss confirm modal. */
  onDismiss: (pair: DuplicatePair) => void;
  /** Disables Merge/Dismiss while a mutation is mid-flight. */
  actionsBusy?: boolean;
}

const SIDE_LABEL = {
  duplicate: { title: 'New order', tone: 'border-danger-300 dark:border-danger-700/70 bg-danger-50/40 dark:bg-danger-900/15' },
  original: { title: 'Existing order', tone: 'border-app-border bg-app-elevated' },
} as const;

function formatPairFlag(kind: DuplicatePair['flagKind']) {
  if (kind === 'POSSIBLY_DUPLICATE') return 'Possibly duplicate · same phone within 30 days';
  return 'Flagged · same phone in the last 24 hours';
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OrderColumn({
  side,
  order,
  isOriginal,
}: {
  side: 'duplicate' | 'original';
  order: CSOrder;
  isOriginal: boolean;
}) {
  const meta = SIDE_LABEL[side];
  return (
    <div className={`flex flex-col rounded-lg border p-3 sm:p-4 ${meta.tone}`}>
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-app-border/70">
        <span className="text-micro font-bold uppercase tracking-wider text-app-fg-muted">
          {meta.title}
        </span>
        <OrderStatusBadge status={order.status} showDot={false} className="!text-xs" />
      </div>

      <dl className="mt-2.5 space-y-2 text-sm">
        <div>
          <dt className="text-micro font-medium uppercase tracking-wider text-app-fg-muted">
            Order
          </dt>
          <dd className="mt-0.5">
            <OrderIdBadge
              id={order.id}
              length={8}
              ellipsis="…"
              linkTo={`/admin/orders/${order.id}`}
              newTab
              textClassName="font-mono text-xs text-brand-600 dark:text-brand-400 hover:underline"
              className="inline-flex"
            />
          </dd>
        </div>

        <div>
          <dt className="text-micro font-medium uppercase tracking-wider text-app-fg-muted">
            Customer
          </dt>
          <dd className="mt-0.5 font-medium text-app-fg truncate" title={order.customerName}>
            {order.customerName}
          </dd>
          <dd className="font-mono text-mini text-app-fg-muted">
            {order.customerPhoneDisplay || '—'}
          </dd>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-app-fg-muted">
              {isOriginal ? 'Placed' : 'New attempt'}
            </dt>
            <dd className="mt-0.5 text-xs text-app-fg-muted tabular-nums">
              {formatWhen(order.createdAt)}
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-micro font-medium uppercase tracking-wider text-app-fg-muted">
              Total
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-app-fg tabular-nums">
              {order.totalAmount ? (
                <NairaPrice amount={Number(order.totalAmount)} />
              ) : (
                <span className="text-app-fg-muted">—</span>
              )}
            </dd>
          </div>
        </div>

        {order.assignedCsId ? (
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-app-fg-muted">
              Assigned CS
            </dt>
            <dd className="mt-0.5 font-mono text-mini text-app-fg-muted">
              {order.assignedCsId.slice(0, 8)}…
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function DuplicateCompareModal({
  pair,
  onClose,
  onMerge,
  onDismiss,
  actionsBusy = false,
}: DuplicateCompareModalProps) {
  const open = pair != null;
  const original = pair?.original ?? null;
  const isSoft = pair?.flagKind === 'POSSIBLY_DUPLICATE';

  return (
    <Modal
      open={open}
      onClose={actionsBusy ? () => undefined : onClose}
      maxWidth="max-w-3xl"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
      aria-labelledby="duplicate-compare-title"
    >
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="duplicate-compare-title" className="text-lg font-semibold text-app-fg">
            Compare duplicate
          </h2>
          {pair ? (
            <p
              className={`text-xs mt-0.5 ${
                isSoft
                  ? 'text-warning-700 dark:text-warning-400'
                  : 'text-danger-700 dark:text-danger-400'
              }`}
            >
              {formatPairFlag(pair.flagKind)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={actionsBusy ? undefined : onClose}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {pair ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <OrderColumn side="duplicate" order={pair.duplicate} isOriginal={false} />
              {original ? (
                <OrderColumn side="original" order={original} isOriginal />
              ) : (
                <div className="flex flex-col items-stretch justify-center rounded-lg border border-warning-200 dark:border-warning-800/70 bg-warning-50/40 dark:bg-warning-900/15 p-4 text-sm text-warning-800 dark:text-warning-300">
                  <p className="font-medium">Original order not found</p>
                  <p className="mt-1 text-xs">
                    The matching earlier order is no longer in the system. Merge is disabled — Dismiss
                    if this is a legitimate new order.
                  </p>
                </div>
              )}
            </div>

            <InlineNotification
              variant={isSoft ? 'warning' : 'info'}
              message="Merging combines items into the existing order, sums the totals, and cancels the new attempt. Dismissing keeps both orders separate and removes the duplicate flag. Both actions are logged in the audit trail."
            />

            <p className="text-xs text-app-fg-muted">
              Need more context? Open each order to see full timeline, items, and CS notes.{' '}
              <Link
                to={`/admin/orders/${pair.duplicate.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                New order →
              </Link>
              {original ? (
                <>
                  {' · '}
                  <Link
                    to={`/admin/orders/${original.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    Existing order →
                  </Link>
                </>
              ) : null}
            </p>
          </>
        ) : null}
      </div>

      <div className="px-5 py-3 border-t border-app-border flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={actionsBusy}>
          Close
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => pair && onDismiss(pair)}
          disabled={!pair || actionsBusy}
        >
          Dismiss flag
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => pair && onMerge(pair)}
          disabled={!pair || !original || actionsBusy}
          title={!original ? 'Original order missing — cannot merge' : undefined}
        >
          Merge into existing
        </Button>
      </div>
    </Modal>
  );
}
