import { useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { CountPill } from '~/components/ui/count-pill';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Textarea } from '~/components/ui/textarea';
import type { AdSpendGroup, AdSpendGroupLine, RolledStatus } from './types';

const PLATFORM_PRESET: Record<'FACEBOOK' | 'TIKTOK' | 'GOOGLE', string> = {
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  GOOGLE: 'Google',
};

const CATEGORY_LABELS: Record<string, string> = {
  AD_SPEND: 'Ad Spend',
  AD_ACCOUNT: 'Ad Account',
  RECRUITMENT_AD: 'Recruitment Ad',
  WHATSAPP_CAMPAIGN: 'WhatsApp Campaign',
  UGC_PRODUCTION: 'UGC Production',
};

function linePlatformLabel(line: AdSpendGroupLine): string {
  if (line.platform === 'OTHER') {
    return line.platformCustomLabel?.trim() || 'Other';
  }
  return PLATFORM_PRESET[line.platform as keyof typeof PLATFORM_PRESET] ?? line.platform;
}

function rolledStatusLabel(s: RolledStatus): string {
  if (s === 'PENDING') return 'Pending';
  if (s === 'APPROVED') return 'Approved';
  if (s === 'REJECTED') return 'Rejected';
  return 'Mixed';
}

/** Returns true when the current viewer can edit this specific line.
 *  CEO directive 2026-05-03: MBs can correct mistakes on their own submissions
 *  until the HoM acts on them — so PENDING (untouched) and REJECTED (sent back)
 *  rows are editable, but APPROVED rows are locked. Moderators (HoM / admin)
 *  can edit any non-approved row regardless of ownership, since they may also
 *  be the ones fixing typos before approving. */
function canEditLine(
  line: AdSpendGroupLine,
  currentUserId: string | undefined,
  canModerate: boolean,
): boolean {
  if (line.status === 'APPROVED') return false;
  if (canModerate) return true;
  return !!currentUserId && line.mediaBuyerId === currentUserId;
}

function buildAdSpendLineColumns(
  canModerate: boolean,
  currentUserId: string | undefined,
  actionUrl: string,
  onPreviewReceipt: (line: AdSpendGroupLine) => void,
  onEdit: ((line: AdSpendGroupLine) => void) | undefined,
): CompactTableColumn<AdSpendGroupLine>[] {
  const cols: CompactTableColumn<AdSpendGroupLine>[] = [
    {
      key: 'campaign',
      header: 'Campaign',
      render: (line) => {
        const cat = line.category ?? 'AD_SPEND';
        if (cat !== 'AD_SPEND') {
          const label = CATEGORY_LABELS[cat] ?? cat;
          return (
            <span className="text-sm text-app-fg">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-app-hover text-app-fg-muted">{label}</span>
              {line.description && <span className="ml-1.5 text-xs text-app-fg-muted">{line.description}</span>}
            </span>
          );
        }
        return <span className="text-sm">{line.campaignName ?? '—'}</span>;
      },
    },
    {
      key: 'product',
      header: 'Product',
      render: (line) => {
        if ((line.category ?? 'AD_SPEND') !== 'AD_SPEND') return <span className="text-app-fg-muted">—</span>;
        return line.productId ? (
          <Link to={`/admin/products/${line.productId}`} className="text-brand-500 hover:text-brand-600">
            {line.productName ?? '—'}
          </Link>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (line) => {
        if ((line.category ?? 'AD_SPEND') !== 'AD_SPEND') return <span className="text-app-fg-muted">—</span>;
        return linePlatformLabel(line);
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      nowrap: true,
      render: (line) => <NairaPrice amount={Number(line.spendAmount)} />,
    },
    {
      key: 'orders',
      header: 'Orders',
      align: 'right',
      nowrap: true,
      render: (line) => {
        if ((line.category ?? 'AD_SPEND') !== 'AD_SPEND') return <span className="text-sm text-app-fg-muted">—</span>;
        return <span className="text-sm text-app-fg-muted tabular-nums">{(line.orderCount ?? 0).toLocaleString()}</span>;
      },
    },
    {
      key: 'cpa',
      header: 'CPA',
      align: 'right',
      nowrap: true,
      render: (line) => {
        if ((line.category ?? 'AD_SPEND') !== 'AD_SPEND') return <span className="text-sm text-app-fg-muted">—</span>;
        return line.indicativeCpa != null ? (
          <NairaPrice amount={line.indicativeCpa} />
        ) : (
          <span className="text-sm text-app-fg-muted">—</span>
        );
      },
    },
    {
      key: 'ad',
      header: 'Ad',
      render: (line) =>
        line.adUrl ? (
          <a
            href={line.adUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:text-brand-600 underline"
          >
            View ad
          </a>
        ) : (
          <span className="text-app-fg-muted">—</span>
        ),
    },
    {
      key: 'screenshot',
      header: 'Screenshot',
      render: (line) => (
        <CompactTableActionButton tone="brand" onClick={() => onPreviewReceipt(line)}>
          View
        </CompactTableActionButton>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (line) => <StatusBadge status={line.status} />,
    },
  ];
  // Actions column always renders when there's *any* possible action — the
  // submitter (MB) gets just the Edit button on their own PENDING/REJECTED rows;
  // moderators get Edit + Approve + Reject. APPROVED rows are locked (no Edit).
  cols.push({
    key: 'actions',
    header: 'Actions',
    align: 'right',
    tight: true,
    nowrap: true,
    minWidth: canModerate ? 'min-w-[12rem]' : 'min-w-[5rem]',
    mobileShowLabel: false,
    render: (line) => (
      <AdSpendLineActionsCell
        line={line}
        actionUrl={actionUrl}
        canModerate={canModerate}
        canEdit={canEditLine(line, currentUserId, canModerate)}
        onEdit={onEdit}
      />
    ),
  });
  return cols;
}

function AdSpendLineActionsCell({
  line,
  actionUrl,
  canModerate,
  canEdit,
  onEdit,
}: {
  line: AdSpendGroupLine;
  actionUrl: string;
  canModerate: boolean;
  canEdit: boolean;
  onEdit?: (line: AdSpendGroupLine) => void;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const [confirmAction, setConfirmAction] = useState<'approveAdSpend' | 'rejectAdSpend' | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const submit = (intent: 'approveAdSpend' | 'rejectAdSpend', reason?: string) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('adSpendId', line.id);
    if (reason) fd.set('reason', reason);
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const closeConfirm = () => {
    if (submitting) return;
    setConfirmAction(null);
    setRejectReason('');
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction === 'rejectAdSpend') {
      submit('rejectAdSpend', rejectReason.trim() || undefined);
    } else {
      submit('approveAdSpend');
    }
  };

  // Approved row with no edit affordance for the viewer → show rejection reason
  // (if any) or em-dash. Same fall-through behavior the moderation cell used to
  // have, but now also covers MB viewers who can't edit approved rows either.
  const showApprovedFallback = line.status === 'APPROVED' || (!canEdit && !canModerate);
  if (showApprovedFallback) {
    return (
      <span className="text-xs text-app-fg-muted">
        {line.status === 'REJECTED' && line.rejectionReason ? line.rejectionReason : '—'}
      </span>
    );
  }

  return (
    <>
      <div className="inline-flex flex-nowrap items-center justify-end gap-2 shrink-0">
        {canEdit && onEdit && (
          <CompactTableActionButton tone="brand" onClick={() => onEdit(line)}>
            Edit
          </CompactTableActionButton>
        )}
        {canModerate && line.status === 'PENDING' && (
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setConfirmAction('approveAdSpend')}
              disabled={submitting}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmAction('rejectAdSpend')}
              disabled={submitting}
            >
              Reject
            </Button>
          </>
        )}
        {canModerate && line.status === 'REJECTED' && line.rejectionReason && (
          <span className="text-xs text-app-fg-muted truncate max-w-[12rem]" title={line.rejectionReason}>
            {line.rejectionReason}
          </span>
        )}
      </div>

      {/* Approve confirmation — friendly, surfaces the amount + campaign so HoM
          isn't approving the wrong line. Variant `archive` keeps the chrome
          neutral; the action itself is positive but irreversible enough to
          warrant a checkpoint. */}
      <ConfirmActionModal
        open={confirmAction === 'approveAdSpend'}
        onClose={closeConfirm}
        title="Approve this ad spend?"
        description={
          <>
            You're approving{' '}
            <span className="font-medium text-app-fg">
              ₦{Number(line.spendAmount).toLocaleString()}
            </span>{' '}
            on <span className="font-medium text-app-fg">{line.campaignName ?? 'this campaign'}</span>
            {line.mediaBuyerName ? (
              <> from <span className="font-medium text-app-fg">{line.mediaBuyerName}</span></>
            ) : null}
            . Once approved it counts toward the period's totals and the Media Buyer can no longer edit it.
          </>
        }
        confirmLabel={submitting ? 'Approving…' : 'Approve'}
        cancelLabel="Cancel"
        variant="archive"
        onConfirm={handleConfirm}
        loading={submitting}
      />

      {/* Reject confirmation — captures the (optional) reason inline instead of
          a `window.prompt`. Reason is kept short; if blank, rejection still
          goes through (server allows it) but the MB sees no explanation,
          so we nudge the user toward filling it in. */}
      <ConfirmActionModal
        open={confirmAction === 'rejectAdSpend'}
        onClose={closeConfirm}
        title="Reject this ad spend?"
        description={
          <>
            You're rejecting{' '}
            <span className="font-medium text-app-fg">
              ₦{Number(line.spendAmount).toLocaleString()}
            </span>
            {line.mediaBuyerName ? (
              <> from <span className="font-medium text-app-fg">{line.mediaBuyerName}</span></>
            ) : null}
            . The Media Buyer can correct and re-submit after rejection.
          </>
        }
        details={
          <Textarea
            label="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why is this being rejected? Helps the Media Buyer fix and re-submit."
            disabled={submitting}
          />
        }
        confirmLabel={submitting ? 'Rejecting…' : 'Reject'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirm}
        loading={submitting}
      />
    </>
  );
}

function formatDate(ymd: string): string {
  // ymd is YYYY-MM-DD; render in local format without timezone shift.
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-NG', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Relative-day label ("Today", "Yesterday", "3 days ago", or short date) for
 *  the secondary line on the accordion header. Calendar-day based, not 24h
 *  rolling — feels right for an ops dashboard. */
function relativeDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return '';
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays === -1) return 'Tomorrow';
  if (diffDays < 0) return `In ${-diffDays} days`;
  return '';
}

/** Tally of per-line statuses + unique product names (header overview). */
function summarizeLines(lines: AdSpendGroupLine[]): {
  pending: number;
  approved: number;
  rejected: number;
  products: string[];
} {
  const products = new Set<string>();
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  for (const line of lines) {
    if (line.status === 'PENDING') pending += 1;
    else if (line.status === 'APPROVED') approved += 1;
    else if (line.status === 'REJECTED') rejected += 1;
    if (line.productName) products.add(line.productName);
  }
  return {
    pending,
    approved,
    rejected,
    products: [...products],
  };
}

interface AdSpendDayAccordionProps {
  groups: AdSpendGroup[];
  /** Show MB column inside expanded rows + on the header (HoM/admin only). */
  showMediaBuyerColumn: boolean;
  /** When true, per-line approve/reject buttons render (HoM/admin only). */
  canModerate: boolean;
  /** Current viewer's id — used to gate per-line "Edit" actions. MB sees Edit
   *  only on rows they own; moderators see Edit on any non-approved row. */
  currentUserId?: string;
  page: number;
  totalPages: number;
  /** URL-driven rows-per-page — feeds the `<Pagination>` per-page picker. */
  pageSize?: number;
  /** Remix action URL for approve/reject intents. */
  actionUrl: string;
  /** Open a receipt/screenshot inside the parent modal. */
  onPreviewReceipt: (line: AdSpendGroupLine) => void;
  /** Open the parent's edit modal pre-filled with this line. Required to show
   *  the Edit button — without it the action falls back to the row's other
   *  affordances. */
  onEdit?: (line: AdSpendGroupLine) => void;
}

export function AdSpendDayAccordion({
  groups,
  showMediaBuyerColumn,
  canModerate,
  currentUserId,
  page,
  totalPages,
  pageSize,
  actionUrl,
  onPreviewReceipt,
  onEdit,
}: AdSpendDayAccordionProps) {
  // Default to fully collapsed so long lists stay scannable.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const lineColumns = useMemo(
    () => buildAdSpendLineColumns(canModerate, currentUserId, actionUrl, onPreviewReceipt, onEdit),
    [canModerate, currentUserId, actionUrl, onPreviewReceipt, onEdit],
  );

  const toggle = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <EmptyState
        variant="card"
        title="No expenses logged in this period"
        description="Use Add Expense to record today's ads in one go."
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {groups.map((g) => {
          const key = `${g.spendDate}::${g.mediaBuyerId}`;
          const isOpen = openKeys.has(key);
          const summary = summarizeLines(g.lines);
          const relativeLabel = relativeDateLabel(g.spendDate);
          // Show top 2 product names, rest collapses to "+N more".
          const productPreview = summary.products.slice(0, 2).join(', ');
          const productOverflow = summary.products.length - 2;
          return (
            <li
              key={key}
              className={[
                'group rounded-lg border bg-app-elevated overflow-hidden transition-colors',
                isOpen
                  ? 'border-app-border-strong'
                  : 'border-app-border hover:border-app-border-strong',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                className="w-full text-left px-3 py-2 hover:bg-app-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset"
                aria-expanded={isOpen}
              >
                {/* Compact 2-row header. Row 1: date · relative · MB · ₦ total.
                    Row 2: ads · status pills · product preview · orders/CPA · rolled status. */}
                <div className="flex items-center gap-2 w-full min-w-0">
                  <ChevronIcon open={isOpen} />
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    {/* Row 1 */}
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex items-center gap-2 truncate text-sm">
                        <span className="font-semibold text-app-fg shrink-0 truncate">
                          {formatDate(g.spendDate)}
                        </span>
                        {relativeLabel && (
                          <span className="text-mini uppercase tracking-wider text-app-fg-muted/80 font-medium shrink-0">
                            {relativeLabel}
                          </span>
                        )}
                        {showMediaBuyerColumn && g.mediaBuyerName && (
                          <>
                            <span className="text-app-fg-muted/60 shrink-0">·</span>
                            <span className="text-app-fg-muted truncate">{g.mediaBuyerName}</span>
                          </>
                        )}
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-app-fg tabular-nums leading-tight">
                        <NairaPrice amount={Number(g.totalAmount)} />
                      </div>
                    </div>

                    {/* Row 2 */}
                    <div className="flex items-center justify-between gap-3 min-w-0 text-xs">
                      <div className="min-w-0 flex items-center gap-x-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        <span className="text-app-fg-muted shrink-0">
                          <span className="font-medium text-app-fg tabular-nums">{g.lineCount}</span>{' '}
                          ad{g.lineCount === 1 ? '' : 's'}
                        </span>
                        {summary.pending > 0 && (
                          <CountPill tone="warning" label="Pending" count={summary.pending} />
                        )}
                        {summary.approved > 0 && (
                          <CountPill tone="success" label="Approved" count={summary.approved} />
                        )}
                        {summary.rejected > 0 && (
                          <CountPill tone="danger" label="Rejected" count={summary.rejected} />
                        )}
                        {productPreview && (
                          <span className="inline-flex items-center gap-1 text-app-fg-muted min-w-0 max-w-[min(12rem,100%)] shrink">
                            <ProductIcon />
                            <span className="truncate">{productPreview}</span>
                            {productOverflow > 0 && (
                              <span className="text-app-fg-muted/70 shrink-0">+{productOverflow}</span>
                            )}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2 text-app-fg-muted tabular-nums whitespace-nowrap">
                        <span>
                          <span className="font-medium text-app-fg/90">{(g.overallOrderCount ?? 0).toLocaleString()}</span>{' '}
                          orders
                          {g.overallCpa != null ? (
                            <>
                              {' '}
                              · <NairaPrice amount={g.overallCpa} /> CPA
                            </>
                          ) : null}
                        </span>
                        <StatusBadge
                          status={g.rolledStatus}
                          label={rolledStatusLabel(g.rolledStatus)}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-app-border bg-app-base">
                  <div className="hidden md:block overflow-x-auto">
                    <CompactTable
                      withCard={false}
                      columns={lineColumns}
                      rows={g.lines}
                      rowKey={(line) => line.id}
                    />
                  </div>

                  <div className="md:hidden divide-y divide-app-border">
                    {g.lines.map((line) => (
                      <LineCardMobile
                        key={line.id}
                        line={line}
                        canModerate={canModerate}
                        canEdit={canEditLine(line, currentUserId, canModerate)}
                        actionUrl={actionUrl}
                        onPreviewReceipt={onPreviewReceipt}
                        onEdit={onEdit}
                      />
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {`Page ${page} of ${totalPages}`}
          </p>
          <Pagination
            page={page}
            totalPages={totalPages}
            pageParam="gpage"
            pageSize={pageSize}
            pageSizeParam="gPerPage"
          />
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 mt-0.5 shrink-0 text-app-fg-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ProductIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-app-fg-muted/70"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

interface LineCardMobileProps {
  line: AdSpendGroupLine;
  canModerate: boolean;
  canEdit: boolean;
  actionUrl: string;
  onPreviewReceipt: (line: AdSpendGroupLine) => void;
  onEdit?: (line: AdSpendGroupLine) => void;
}

function LineCardMobile({
  line,
  canModerate,
  canEdit,
  actionUrl,
  onPreviewReceipt,
  onEdit,
}: LineCardMobileProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';
  const [confirmAction, setConfirmAction] = useState<'approveAdSpend' | 'rejectAdSpend' | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const submit = (intent: 'approveAdSpend' | 'rejectAdSpend', reason?: string) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('adSpendId', line.id);
    if (reason) fd.set('reason', reason);
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const closeConfirm = () => {
    if (submitting) return;
    setConfirmAction(null);
    setRejectReason('');
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction === 'rejectAdSpend') {
      submit('rejectAdSpend', rejectReason.trim() || undefined);
    } else {
      submit('approveAdSpend');
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          <NairaPrice amount={Number(line.spendAmount)} />
        </span>
        <StatusBadge status={line.status} />
      </div>
      <p className="text-sm text-app-fg-muted">
        {line.campaignName ?? '—'} · {line.productName ?? '—'} ·{' '}
        {linePlatformLabel(line)}
      </p>
      <p className="text-xs text-app-fg-muted tabular-nums">
        Orders: {(line.orderCount ?? 0).toLocaleString()}
        {line.indicativeCpa != null ? (
          <>
            {' '}
            · CPA <NairaPrice amount={line.indicativeCpa} />
          </>
        ) : (
          ' · CPA —'
        )}
      </p>
      <div className="flex flex-nowrap gap-3 text-xs overflow-x-auto">
        {line.adUrl && (
          <a
            href={line.adUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:text-brand-600 underline"
          >
            View ad
          </a>
        )}
        <button
          type="button"
          onClick={() => onPreviewReceipt(line)}
          className="text-brand-500 hover:text-brand-600 underline"
        >
          View screenshot
        </button>
      </div>
      <div className="inline-flex flex-wrap items-center gap-2 pt-1">
        {canEdit && onEdit && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(line)}>
            Edit
          </Button>
        )}
        {canModerate && line.status === 'PENDING' && (
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setConfirmAction('approveAdSpend')}
              disabled={submitting}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmAction('rejectAdSpend')}
              disabled={submitting}
            >
              Reject
            </Button>
          </>
        )}
      </div>
      {line.status === 'REJECTED' && line.rejectionReason && (
        <p className="text-xs text-danger-600">{line.rejectionReason}</p>
      )}

      <ConfirmActionModal
        open={confirmAction === 'approveAdSpend'}
        onClose={closeConfirm}
        title="Approve this ad spend?"
        description={
          <>
            You're approving{' '}
            <span className="font-medium text-app-fg">
              ₦{Number(line.spendAmount).toLocaleString()}
            </span>{' '}
            on <span className="font-medium text-app-fg">{line.campaignName ?? 'this campaign'}</span>
            {line.mediaBuyerName ? (
              <> from <span className="font-medium text-app-fg">{line.mediaBuyerName}</span></>
            ) : null}
            . Once approved it counts toward the period's totals and the Media Buyer can no longer edit it.
          </>
        }
        confirmLabel={submitting ? 'Approving…' : 'Approve'}
        cancelLabel="Cancel"
        variant="archive"
        onConfirm={handleConfirm}
        loading={submitting}
      />

      <ConfirmActionModal
        open={confirmAction === 'rejectAdSpend'}
        onClose={closeConfirm}
        title="Reject this ad spend?"
        description={
          <>
            You're rejecting{' '}
            <span className="font-medium text-app-fg">
              ₦{Number(line.spendAmount).toLocaleString()}
            </span>
            {line.mediaBuyerName ? (
              <> from <span className="font-medium text-app-fg">{line.mediaBuyerName}</span></>
            ) : null}
            . The Media Buyer can correct and re-submit after rejection.
          </>
        }
        details={
          <Textarea
            label="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why is this being rejected? Helps the Media Buyer fix and re-submit."
            disabled={submitting}
          />
        }
        confirmLabel={submitting ? 'Rejecting…' : 'Reject'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirm}
        loading={submitting}
      />
    </div>
  );
}
