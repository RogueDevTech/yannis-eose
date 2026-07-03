import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { Textarea } from '~/components/ui/textarea';
import { EmptyState } from '~/components/ui/empty-state';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type { MarketingDateFilters } from './types';

// ── Types ───────────────────────────────────────────────────────────────

export interface MbFundTransferRecord {
  id: string;
  senderMbId: string;
  senderName: string | null;
  receiverMbId: string;
  receiverName: string | null;
  amount: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACCEPTED';
  branchId: string | null;
  createdAt: string;
  approvedBy: string | null;
  approverName: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  acceptedAt: string | null;
}

export interface MbFundTransfersLoaderData {
  transfers: MbFundTransferRecord[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  currentUserId: string;
  currentUserRole: string;
  canApprove: boolean;
  mediaBuyers: Array<{ id: string; name: string }>;
  filters: MarketingDateFilters;
  direction: string;
  statusCounts: { PENDING: number; APPROVED: number; REJECTED: number; ACCEPTED: number; ALL: number };
}

type TransferTab = 'all' | 'sent' | 'received' | 'pending_approval';

const DIRECTION_TABS: Array<{ value: TransferTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'received', label: 'Received' },
  { value: 'pending_approval', label: 'Pending Approval' },
];

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'info' | 'danger' | 'success' }> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'info' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  ACCEPTED: { label: 'Accepted', variant: 'success' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Page Component ──────────────────────────────────────────────────────

export function MbFundTransfersPage({
  transfers,
  total,
  page,
  totalPages,
  limit,
  currentUserId,
  currentUserRole,
  canApprove,
  mediaBuyers,
  filters,
  direction,
  statusCounts,
}: MbFundTransfersLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailTransfer, setDetailTransfer] = useState<MbFundTransferRecord | null>(null);
  const [rejectTransferId, setRejectTransferId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { busy: isRefreshing } = useLoaderRefetchBusy();

  // ── Tabs (with badge counts) ────────────────────────────────────────
  const directionTabs = useMemo(() => {
    const tabs = DIRECTION_TABS.map((t) => {
      if (t.value === 'pending_approval' && !canApprove) return null;
      const countMap: Record<TransferTab, number> = {
        all: statusCounts.ALL,
        sent: statusCounts.ALL,
        received: statusCounts.ALL,
        pending_approval: statusCounts.PENDING,
      };
      const count = countMap[t.value];
      return {
        ...t,
        badge: count > 0 ? (
          <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-app-fg/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
            {count}
          </span>
        ) : undefined,
      };
    });
    return tabs.filter(Boolean) as Array<{ value: string; label: string; badge?: ReactNode }>;
  }, [canApprove, statusCounts]);

  const activeTab = direction as TransferTab;

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('direction', value);
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const handlePageChange = useCallback(
    (p: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(p));
        return next;
      });
    },
    [setSearchParams],
  );

  // ── Overview Stats ──────────────────────────────────────────────────
  const statItems = useMemo(
    (): OverviewStatStripItem[] => [
      { label: 'Total', value: String(statusCounts.ALL) },
      { label: 'Pending', value: String(statusCounts.PENDING) },
      { label: 'Approved', value: String(statusCounts.APPROVED) },
      { label: 'Accepted', value: String(statusCounts.ACCEPTED) },
      { label: 'Rejected', value: String(statusCounts.REJECTED) },
    ],
    [statusCounts],
  );

  // ── Table Columns ───────────────────────────────────────────────────
  const columns = useMemo(
    (): CompactTableColumn<MbFundTransferRecord>[] => [
      {
        key: 'sender',
        header: 'From',
        render: (t) => (
          <span className="font-medium text-app-fg">
            {t.senderMbId === currentUserId ? 'You' : (t.senderName ?? 'Unknown')}
          </span>
        ),
      },
      {
        key: 'receiver',
        header: 'To',
        render: (t) => (
          <span className="font-medium text-app-fg">
            {t.receiverMbId === currentUserId ? 'You' : (t.receiverName ?? 'Unknown')}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (t) => <NairaPrice amount={Number(t.amount)} />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => {
          const s = STATUS_MAP[t.status] ?? { label: t.status, variant: 'warning' as const };
          return <StatusBadge status={s.label} variant={s.variant} />;
        },
      },
      {
        key: 'date',
        header: 'Date',
        render: (t) => (
          <span className="text-xs text-app-fg-muted tabular-nums">{formatDate(t.createdAt)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileShowLabel: false,
        align: 'right',
        render: (t) => (
          <TransferActions
            transfer={t}
            currentUserId={currentUserId}
            canApprove={canApprove}
            onReject={(id) => { setRejectTransferId(id); setRejectReason(''); }}
          />
        ),
      },
    ],
    [currentUserId, canApprove],
  );

  // ── Mobile Card ─────────────────────────────────────────────────────
  const renderMobileCard = useCallback(
    (t: MbFundTransferRecord) => {
      const s = STATUS_MAP[t.status] ?? { label: t.status, variant: 'warning' as const };
      return (
        <button
          type="button"
          className="w-full text-left rounded-xl border border-app-border bg-app-card p-3.5 active:bg-app-hover transition-colors"
          onClick={() => setDetailTransfer(t)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-app-fg truncate">
                {t.senderMbId === currentUserId ? 'You' : (t.senderName ?? 'Unknown')}
                {' \u2192 '}
                {t.receiverMbId === currentUserId ? 'You' : (t.receiverName ?? 'Unknown')}
              </p>
              {t.reason && (
                <p className="mt-0.5 text-xs text-app-fg-muted line-clamp-1">{t.reason}</p>
              )}
            </div>
            <StatusBadge status={s.label} variant={s.variant} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <NairaPrice amount={Number(t.amount)} className="text-sm font-semibold" />
            <span className="text-[11px] text-app-fg-muted tabular-nums">{formatDate(t.createdAt)}</span>
          </div>
        </button>
      );
    },
    [currentUserId],
  );

  return (
    <div className="space-y-0">
      <PageHeader
        title="MB Fund Transfers"
        description="Peer-to-peer fund transfers between media buyers."
        backTo="/admin/marketing/funding"
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Transfer tools"
            desktop={
              <>
                <PageRefreshButton />
                <Button size="sm" onClick={() => setShowCreateModal(true)}>
                  Send to MB
                </Button>
              </>
            }
            sheet={
              <Button className="w-full" onClick={() => setShowCreateModal(true)}>
                Send to MB
              </Button>
            }
          />
        }
      />

      <div className="px-4 md:px-6 space-y-4 pb-8">
        <DateFilterBar
          startDate={filters.startDate}
          endDate={filters.endDate}
          periodAllTime={filters.periodAllTime}
          chrome="pill"
        />

        <OverviewStatStrip items={statItems} mobileGrid />

        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          tabs={directionTabs}
          variant="pill"
          size="sm"
        />

        {/* Desktop table */}
        <div className="hidden md:block">
          <CompactTable
            columns={columns}
            rows={transfers}
            rowKey={(r) => r.id}
            loading={isRefreshing}
            emptyTitle="No transfers"
            emptyDescription={
              activeTab === 'pending_approval'
                ? 'No transfers pending your approval.'
                : 'No fund transfers found for this period.'
            }
          />
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {transfers.length === 0 ? (
            <EmptyState
              title="No transfers"
              description={
                activeTab === 'pending_approval'
                  ? 'No transfers pending your approval.'
                  : 'No fund transfers found.'
              }
            />
          ) : (
            transfers.map((t) => <div key={t.id}>{renderMobileCard(t)}</div>)
          )}
        </div>

        {totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
        )}
      </div>

      {/* ── Create Transfer Modal ──────────────────────────────────── */}
      <CreateTransferModal
        open={showCreateModal}
        mediaBuyers={mediaBuyers}
        currentUserId={currentUserId}
        onClose={() => setShowCreateModal(false)}
      />

      {/* ── Detail Peek Modal ─────────────────────────────────────── */}
      <TransferDetailModal
        open={!!detailTransfer}
        transfer={detailTransfer}
        currentUserId={currentUserId}
        canApprove={canApprove}
        onClose={() => setDetailTransfer(null)}
        onReject={(id) => { setDetailTransfer(null); setRejectTransferId(id); setRejectReason(''); }}
      />

      {/* ── Reject Reason Modal ───────────────────────────────────── */}
      <RejectTransferModal
        open={!!rejectTransferId}
        transferId={rejectTransferId ?? ''}
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectTransferId(null)}
      />
    </div>
  );
}

// ── Inline Action Buttons (desktop table) ───────────────────────────────

function TransferActions({
  transfer,
  currentUserId,
  canApprove,
  onReject,
}: {
  transfer: MbFundTransferRecord;
  currentUserId: string;
  canApprove: boolean;
  onReject: (id: string) => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  const busy = fetcher.state !== 'idle';

  if (canApprove && transfer.status === 'PENDING') {
    return (
      <div className="flex items-center gap-1.5">
        <TableActionButton
          onClick={() =>
            fetcher.submit(
              { intent: 'approve', transferId: transfer.id },
              { method: 'post' },
            )
          }
          disabled={busy}
        >
          Approve
        </TableActionButton>
        <TableActionButton variant="danger" onClick={() => onReject(transfer.id)} disabled={busy}>
          Reject
        </TableActionButton>
      </div>
    );
  }

  if (transfer.status === 'APPROVED' && transfer.receiverMbId === currentUserId) {
    return (
      <TableActionButton
        onClick={() =>
          fetcher.submit(
            { intent: 'accept', transferId: transfer.id },
            { method: 'post' },
          )
        }
        disabled={busy}
      >
        Accept
      </TableActionButton>
    );
  }

  return null;
}

// ── Create Transfer Modal ───────────────────────────────────────────────

function CreateTransferModal({
  open,
  mediaBuyers,
  currentUserId,
  onClose,
}: {
  open: boolean;
  mediaBuyers: Array<{ id: string; name: string }>;
  currentUserId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  useCloseOnFetcherSuccess(fetcher, () => onClose());

  const [receiverId, setReceiverId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const busy = fetcher.state !== 'idle';

  const recipientOptions = useMemo(
    () => mediaBuyers.filter((mb) => mb.id !== currentUserId).map((mb) => ({ value: mb.id, label: mb.name })),
    [mediaBuyers, currentUserId],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!receiverId || !amount) return;
      fetcher.submit(
        { intent: 'create', receiverMbId: receiverId, amount, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        { method: 'post' },
      );
    },
    [fetcher, receiverId, amount, reason],
  );

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold text-app-fg">Send Funds to MB</h3>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Recipient</label>
          <SearchableSelect
            options={recipientOptions}
            value={receiverId}
            onChange={setReceiverId}
            placeholder="Select media buyer..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Amount</label>
          <AmountInput value={amount} onChange={setAmount} placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Reason (optional)</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you sending this?"
            rows={2}
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !receiverId || !amount}>
            {busy ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Detail Peek Modal (mobile) ──────────────────────────────────────────

function TransferDetailModal({
  open,
  transfer,
  currentUserId,
  canApprove,
  onClose,
  onReject,
}: {
  open: boolean;
  transfer: MbFundTransferRecord | null;
  currentUserId: string;
  canApprove: boolean;
  onClose: () => void;
  onReject: (id: string) => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  useCloseOnFetcherSuccess(fetcher, () => onClose());
  const busy = fetcher.state !== 'idle';

  if (!transfer) return <Modal open={false} onClose={onClose}>{null}</Modal>;

  const s = STATUS_MAP[transfer.status] ?? { label: transfer.status, variant: 'warning' as const };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-app-fg">Transfer Details</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Status</span>
          <StatusBadge status={s.label} variant={s.variant} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Amount</span>
          <NairaPrice amount={Number(transfer.amount)} className="text-sm font-semibold" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">From</span>
          <span className="text-sm font-medium text-app-fg">
            {transfer.senderMbId === currentUserId ? 'You' : (transfer.senderName ?? 'Unknown')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">To</span>
          <span className="text-sm font-medium text-app-fg">
            {transfer.receiverMbId === currentUserId ? 'You' : (transfer.receiverName ?? 'Unknown')}
          </span>
        </div>
        {transfer.reason && (
          <div>
            <span className="text-sm text-app-fg-muted">Reason</span>
            <p className="mt-0.5 text-sm text-app-fg">{transfer.reason}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Date</span>
          <span className="text-sm text-app-fg tabular-nums">{formatDate(transfer.createdAt)}</span>
        </div>
        {transfer.approverName && transfer.approvedAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-app-fg-muted">Approved by</span>
            <span className="text-sm text-app-fg">{transfer.approverName} on {formatDate(transfer.approvedAt)}</span>
          </div>
        )}
        {transfer.rejectionReason && (
          <div>
            <span className="text-sm text-app-fg-muted">Rejection reason</span>
            <p className="mt-0.5 text-sm text-danger-600 dark:text-danger-400">{transfer.rejectionReason}</p>
          </div>
        )}
        {transfer.acceptedAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-app-fg-muted">Accepted</span>
            <span className="text-sm text-app-fg tabular-nums">{formatDate(transfer.acceptedAt)}</span>
          </div>
        )}
      </div>

      {canApprove && transfer.status === 'PENDING' && (
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            onClick={() =>
              fetcher.submit({ intent: 'approve', transferId: transfer.id }, { method: 'post' })
            }
            disabled={busy}
          >
            {busy ? 'Approving...' : 'Approve'}
          </Button>
          <Button className="flex-1" variant="danger" onClick={() => onReject(transfer.id)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {transfer.status === 'APPROVED' && transfer.receiverMbId === currentUserId && (
        <div className="mt-4">
          <Button
            className="w-full"
            onClick={() =>
              fetcher.submit({ intent: 'accept', transferId: transfer.id }, { method: 'post' })
            }
            disabled={busy}
          >
            {busy ? 'Accepting...' : 'Accept Transfer'}
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ── Reject Reason Modal ─────────────────────────────────────────────────

function RejectTransferModal({
  open,
  transferId,
  reason,
  onReasonChange,
  onClose,
}: {
  open: boolean;
  transferId: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher);
  useCloseOnFetcherSuccess(fetcher, () => onClose());
  const busy = fetcher.state !== 'idle';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!reason.trim()) return;
      fetcher.submit(
        { intent: 'reject', transferId, rejectionReason: reason.trim() },
        { method: 'post' },
      );
    },
    [fetcher, transferId, reason],
  );

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold text-app-fg">Reject Transfer</h3>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Reason for rejection</label>
          <Textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Explain why this transfer is being rejected..."
            rows={3}
            maxLength={500}
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
            {busy ? 'Rejecting...' : 'Reject'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
