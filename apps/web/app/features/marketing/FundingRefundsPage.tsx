import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListPatches, applyOptimisticPatches } from '~/hooks/useOptimisticListPatches';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Tabs } from '~/components/ui/tabs';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { AmountInput } from '~/components/ui/amount-input';
import type {
  FundingRefundRecord,
  FundingRefundStatus,
  FundingRefundView,
  FundingRefundsLoaderData,
} from './types';

const VIEW_LABELS: Record<FundingRefundView, string> = {
  mine: 'My refunds',
  to_review: 'To review',
  all: 'All',
};

const STATUS_TABS: { value: FundingRefundStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function naira(amount: string | number): string {
  return `₦${Number(amount).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

type RowAction = 'approve' | 'reject' | 'complete' | 'cancel';

/** Which actions a row offers, mirroring the API rules. */
function actionsFor(row: FundingRefundRecord, view: FundingRefundView): RowAction[] {
  const out: RowAction[] = [];
  if (view === 'mine' && (row.status === 'PENDING' || row.status === 'APPROVED')) out.push('cancel');
  if (row.canReview && row.status === 'PENDING') out.push('approve', 'reject');
  if (row.canReview && row.status === 'APPROVED') out.push('complete');
  return out;
}

export function FundingRefundsPage({
  view,
  views,
  status,
  search,
  records,
  page,
  limit,
  total,
  filteredTotalAmount,
  statusCounts,
  canRefund,
  refundable,
}: FundingRefundsLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [peekRow, setPeekRow] = useState<FundingRefundRecord | null>(null);
  const [confirm, setConfirm] = useState<{ row: FundingRefundRecord; action: RowAction } | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [fundingId, setFundingId] = useState('');
  const [amount, setAmount] = useState('');

  useFetcherToast(fetcher.data, { skipErrorToast: confirm != null || showRequest });
  const handleSuccess = useCallback(() => {
    setConfirm(null);
    setPeekRow(null);
    setShowRequest(false);
    setAmount('');
    setFundingId('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const buildPatches = useCallback((fd: FormData, intent: string) => {
    const id = fd.get('refundId')?.toString();
    if (!id) return null;
    const next: Partial<Record<string, FundingRefundStatus>> = {
      approveRefund: 'APPROVED',
      rejectRefund: 'REJECTED',
      completeRefund: 'COMPLETED',
      cancelRefund: 'CANCELLED',
    };
    const s = next[intent];
    return s ? [{ id, patch: { status: s } }] : null;
  }, []);
  const patches = useOptimisticListPatches<FundingRefundRecord>(fetcher, buildPatches);
  const rows = useMemo(() => applyOptimisticPatches(records, patches), [records, patches]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next, { preventScrollReset: true });
  };

  const selectedFunding = refundable?.fundings.find((f) => f.id === fundingId) ?? null;
  const available = Number(refundable?.available ?? 0);
  const maxRefund = selectedFunding ? Math.min(available, Number(selectedFunding.refundable)) : available;
  const amountNum = Number(amount || 0);
  const amountError =
    amount && amountNum > maxRefund ? `Most you can refund here: ${naira(maxRefund)}` : undefined;

  const columns = useMemo<CompactTableColumn<FundingRefundRecord>[]>(
    () => [
      {
        key: 'reference',
        header: 'Reference',
        nowrap: true,
        render: (row) => <span className="font-mono text-xs text-app-fg-muted">{row.reference}</span>,
      },
      {
        key: 'from',
        header: 'From',
        nowrap: true,
        render: (row) => <span className="text-sm text-app-fg">{row.refunderName ?? 'Unknown'}</span>,
      },
      {
        key: 'to',
        header: 'Back to',
        nowrap: true,
        render: (row) => <span className="text-sm text-app-fg">{row.funderName ?? 'Unknown'}</span>,
      },
      {
        key: 'funding',
        header: 'Original funding',
        nowrap: true,
        render: (row) => (
          <span className="text-xs text-app-fg-muted">
            <span className="font-mono">{row.fundingReference}</span> · {naira(row.fundingAmount)}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (row) => (
          <span className="font-medium tabular-nums">
            <NairaPrice amount={Number(row.amount)} />
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (row) => (
          <span className="line-clamp-2 max-w-[18rem] text-sm text-app-fg-muted" title={row.reason}>
            {row.reason}
          </span>
        ),
      },
      { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'date',
        header: 'Requested',
        nowrap: true,
        render: (row) => <span className="text-sm text-app-fg-muted">{formatDate(row.requestedAt)}</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (row) => (
          <span className="inline-flex gap-1.5">
            <TableActionButton onClick={() => setPeekRow(row)} variant="neutral">
              View
            </TableActionButton>
            {actionsFor(row, view).map((a) => (
              <TableActionButton
                key={a}
                variant={a === 'reject' || a === 'cancel' ? 'danger' : undefined}
                onClick={() => setConfirm({ row, action: a })}
              >
                {a === 'approve' ? 'Approve' : a === 'reject' ? 'Reject' : a === 'complete' ? 'Confirm received' : 'Cancel'}
              </TableActionButton>
            ))}
          </span>
        ),
      },
    ],
    [view],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const statusTabValue = status ?? 'ALL';

  const refundButton = canRefund ? (
    <Button
      variant="primary"
      size="sm"
      className="h-12 md:h-auto w-full justify-center md:w-auto"
      onClick={() => setShowRequest(true)}
      disabled={!refundable || refundable.fundings.length === 0}
    >
      Refund funds
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding Refunds"
        backTo="/admin/marketing/funding"
        mobileInlineActions
        description="Return unspent funding to the person who sent it."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Refund tools"
            desktop={
              <>
                {refundButton}
                <Link to="/admin/marketing/funding/reconciliation" className="btn-secondary btn-sm">
                  Reconciliation
                </Link>
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                {refundButton}
                <Link
                  to="/admin/marketing/funding/reconciliation"
                  className="btn-secondary h-12 w-full justify-center inline-flex items-center"
                >
                  Reconciliation
                </Link>
                <PageRefreshButton className="w-full justify-center py-2" />
              </>
            }
          />
        }
      />

      {/* Phones: the Actions button for the header tools sheet. */}
      <MobileDateFilterRow hideDate showSearch={false} />

      {canRefund && refundable && (
        <div className="rounded-lg border border-app-border bg-app-elevated px-4 py-3 text-sm">
          <span className="text-app-fg-muted">Unspent balance you can refund: </span>
          <span className="font-semibold tabular-nums text-app-fg">{naira(refundable.available)}</span>
          {refundable.fundings.length === 0 && (
            <span className="ml-2 text-app-fg-muted">No received funding left to refund.</span>
          )}
        </div>
      )}

      <div className="list-panel">
        <div className="flex flex-col gap-2 px-4 pt-3">
          {views.length > 1 && (
            <Tabs
              variant="pill"
              value={view}
              onChange={(v) => {
                const next = new URLSearchParams(searchParams);
                next.set('view', v);
                next.delete('page');
                next.delete('status');
                setSearchParams(next, { preventScrollReset: true });
              }}
              tabs={views.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              variant="pill"
              value={statusTabValue}
              onChange={(v) => setParam('status', v === 'ALL' ? null : v)}
              tabs={STATUS_TABS.map((t) => ({
                value: t.value,
                label: t.label,
                badge: t.value === 'ALL' ? undefined : statusCounts[t.value],
              }))}
            />
            <PageSearchControl
              value={search}
              onApply={(q) => setParam('search', q || null)}
              placeholder="Reference, name or reason"
              title="Search refunds"
            />
          </div>
        </div>
        <div className="px-4 pb-1 pt-2 text-xs text-app-fg-muted">
          {total} {total === 1 ? 'refund' : 'refunds'} · {naira(filteredTotalAmount)}
        </div>
        <CompactTable<FundingRefundRecord>
          columnVisibilityKey="admin.marketing.funding-refunds"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyTitle={view === 'to_review' ? 'No refunds waiting on you.' : 'No refunds yet.'}
          renderMobileCard={(row) => (
            <button type="button" onClick={() => setPeekRow(row)} className="w-full space-y-1 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-app-fg">
                  {view === 'mine' ? `To ${row.funderName ?? 'Unknown'}` : `From ${row.refunderName ?? 'Unknown'}`}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  <NairaPrice amount={Number(row.amount)} />
                </span>
              </div>
              <p className="line-clamp-1 text-xs text-app-fg-muted">{row.reason}</p>
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={row.status} size="sm" />
                <span className="text-xs text-app-fg-muted">
                  {row.reference} · {formatDate(row.requestedAt)}
                </span>
              </div>
            </button>
          )}
          pagination={{ page, totalPages, pageParam: 'page', pageSize: limit, pageSizeParam: 'perPage' }}
        />
      </div>

      {/* Peek: full record, with the actions this person can take */}
      {peekRow && !confirm && (
        <Modal open onClose={() => setPeekRow(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-app-fg">
                <NairaPrice amount={Number(peekRow.amount)} />
              </h3>
              <p className="text-sm text-app-fg-muted">
                {peekRow.refunderName ?? 'Unknown'} → {peekRow.funderName ?? 'Unknown'}
              </p>
            </div>
            <StatusBadge status={peekRow.status} />
          </div>
          <dl className="space-y-1.5 rounded-lg border border-app-border bg-app-hover p-3 text-sm">
            {[
              ['Reference', peekRow.reference],
              ['Original funding', `${peekRow.fundingReference} · ${naira(peekRow.fundingAmount)} · received ${formatDate(peekRow.fundingReceivedAt ?? peekRow.fundingSentAt)}`],
              ['Currency', peekRow.currencyCode],
              ['Requested', formatDate(peekRow.requestedAt)],
              ...(peekRow.reviewedAt
                ? [[peekRow.status === 'REJECTED' ? 'Rejected' : 'Approved', `${formatDate(peekRow.reviewedAt)} by ${peekRow.reviewedByName ?? 'Unknown'}`]]
                : []),
              ...(peekRow.completedAt ? [['Completed', `${formatDate(peekRow.completedAt)} by ${peekRow.completedByName ?? 'Unknown'}`]] : []),
              ...(peekRow.cancelledAt ? [['Cancelled', formatDate(peekRow.cancelledAt)]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-app-fg-muted">{k}</dt>
                <dd className="text-right text-app-fg">{v}</dd>
              </div>
            ))}
            <div className="pt-1">
              <dt className="text-app-fg-muted">Reason</dt>
              <dd className="text-app-fg">{peekRow.reason}</dd>
            </div>
            {peekRow.reviewNote && (
              <div className="pt-1">
                <dt className="text-app-fg-muted">{peekRow.status === 'REJECTED' ? 'Rejection reason' : 'Note'}</dt>
                <dd className="text-app-fg">{peekRow.reviewNote}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {actionsFor(peekRow, view).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'reject' || a === 'cancel' ? 'danger' : 'primary'}
                onClick={() => setConfirm({ row: peekRow, action: a })}
              >
                {a === 'approve' ? 'Approve' : a === 'reject' ? 'Reject' : a === 'complete' ? 'Confirm received' : 'Cancel refund'}
              </Button>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setPeekRow(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Confirm an action */}
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">
            {confirm.action === 'approve' && `Approve refund of ${naira(confirm.row.amount)}?`}
            {confirm.action === 'reject' && `Reject refund of ${naira(confirm.row.amount)}?`}
            {confirm.action === 'complete' && `Confirm you received ${naira(confirm.row.amount)}?`}
            {confirm.action === 'cancel' && `Cancel refund ${confirm.row.reference}?`}
          </h3>
          <p className="text-sm text-app-fg-muted">
            {confirm.action === 'approve' &&
              `${confirm.row.refunderName ?? 'The sender'} will send the money back. Balances change only after you confirm it arrived.`}
            {confirm.action === 'reject' && 'The amount goes back into their available balance.'}
            {confirm.action === 'complete' &&
              `${naira(confirm.row.amount)} is taken from ${confirm.row.refunderName ?? 'the refunder'}'s balance and credited to ${confirm.row.funderName ?? 'the funder'}. This cannot be undone.`}
            {confirm.action === 'cancel' && 'The held amount goes back into your available balance.'}
          </p>
          <ModalFetcherInlineError
            message={surface.errorMatchingIntent(
              confirm.action === 'approve' ? 'approveRefund' : confirm.action === 'reject' ? 'rejectRefund' : confirm.action === 'complete' ? 'completeRefund' : 'cancelRefund',
            )}
          />
          <fetcher.Form method="post" className="space-y-3">
            <input
              type="hidden"
              name="intent"
              value={
                confirm.action === 'approve'
                  ? 'approveRefund'
                  : confirm.action === 'reject'
                    ? 'rejectRefund'
                    : confirm.action === 'complete'
                      ? 'completeRefund'
                      : 'cancelRefund'
              }
            />
            <input type="hidden" name="refundId" value={confirm.row.id} />
            {confirm.action === 'reject' && (
              <Textarea
                label="Reason"
                name="note"
                required
                minLength={10}
                maxLength={500}
                rows={3}
                placeholder="e.g. Keep it for next week's campaign (min 10 chars)"
              />
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant={confirm.action === 'reject' || confirm.action === 'cancel' ? 'danger' : 'primary'}
                loading={fetcher.state === 'submitting'}
                loadingText="Saving..."
              >
                {confirm.action === 'approve'
                  ? 'Approve'
                  : confirm.action === 'reject'
                    ? 'Reject'
                    : confirm.action === 'complete'
                      ? 'Confirm received'
                      : 'Cancel refund'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm(null)}>
                Back
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Request a refund */}
      {showRequest && refundable && (
        <Modal open onClose={() => setShowRequest(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <div>
            <h3 className="text-lg font-semibold text-app-fg">Refund funds</h3>
            <p className="text-sm text-app-fg-muted">
              Unspent balance: <span className="font-medium text-app-fg">{naira(available)}</span>
            </p>
          </div>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('requestRefund')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="requestRefund" />
            <FormSelect
              label="Funding you are returning"
              name="fundingId"
              required
              value={fundingId}
              onChange={(e) => setFundingId(e.target.value)}
              placeholder="Choose a funding"
              options={refundable.fundings.map((f) => ({
                value: f.id,
                label: `${f.funderName} · ${formatDate(f.receivedAt)} · ${f.reference} · ${naira(f.refundable)} left`,
              }))}
            />
            {selectedFunding && (
              <p className="text-xs text-app-fg-muted">
                Goes back to {selectedFunding.funderName}. Funding of {naira(selectedFunding.amount)}
                {Number(selectedFunding.alreadyRefunded) > 0 ? `, ${naira(selectedFunding.alreadyRefunded)} already refunded or waiting` : ''}.
              </p>
            )}
            <div className="space-y-1">
              <label htmlFor="refund-amount" className="block text-sm font-medium text-app-fg">
                Amount
              </label>
              <AmountInput id="refund-amount" name="amount" required prefix="₦" value={amount} onChange={setAmount} />
              <div className="flex items-center justify-between text-xs">
                <span className={amountError ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted'}>
                  {amountError ?? `Up to ${naira(maxRefund)}`}
                </span>
                {maxRefund > 0 && (
                  <button type="button" className="text-brand-600 dark:text-brand-400" onClick={() => setAmount(String(maxRefund))}>
                    Refund all
                  </button>
                )}
              </div>
            </div>
            <Textarea
              label="Reason"
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="e.g. Campaign paused, returning unused budget (min 10 chars)"
            />
            <p className="text-xs text-app-fg-muted">
              The amount is held until your funder approves and confirms they received it.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!fundingId || !amountNum || !!amountError}
                loading={fetcher.state === 'submitting'}
                loadingText="Sending..."
              >
                Request refund
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowRequest(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}
