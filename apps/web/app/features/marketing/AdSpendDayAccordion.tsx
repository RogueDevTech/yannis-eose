import { useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import type { AdSpendGroup, AdSpendGroupLine, RolledStatus } from './types';

const PLATFORM_LABEL: Record<AdSpendGroupLine['platform'], string> = {
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  GOOGLE: 'Google',
};

function rolledStatusLabel(s: RolledStatus): string {
  if (s === 'PENDING') return 'Pending';
  if (s === 'APPROVED') return 'Approved';
  if (s === 'REJECTED') return 'Rejected';
  return 'Mixed';
}

function buildAdSpendLineColumns(
  canModerate: boolean,
  actionUrl: string,
  onPreviewReceipt: (line: AdSpendGroupLine) => void,
): CompactTableColumn<AdSpendGroupLine>[] {
  const cols: CompactTableColumn<AdSpendGroupLine>[] = [
    {
      key: 'campaign',
      header: 'Campaign',
      render: (line) => line.campaignName ?? '—',
    },
    {
      key: 'product',
      header: 'Product',
      render: (line) =>
        line.productId ? (
          <Link to={`/admin/products/${line.productId}`} className="text-brand-500 hover:text-brand-600">
            {line.productName ?? '—'}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (line) => PLATFORM_LABEL[line.platform],
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      nowrap: true,
      render: (line) => <NairaPrice amount={Number(line.spendAmount)} />,
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
  if (canModerate) {
    cols.push({
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      minWidth: 'min-w-[9rem]',
      mobileShowLabel: false,
      render: (line) => <AdSpendLineModerationCell line={line} actionUrl={actionUrl} />,
    });
  }
  return cols;
}

function AdSpendLineModerationCell({
  line,
  actionUrl,
}: {
  line: AdSpendGroupLine;
  actionUrl: string;
}) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';

  const submit = (intent: 'approveAdSpend' | 'rejectAdSpend', reason?: string) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('adSpendId', line.id);
    if (reason) fd.set('reason', reason);
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const handleReject = () => {
    const reason = window.prompt('Reason for rejection (optional)') ?? undefined;
    submit('rejectAdSpend', reason || undefined);
  };

  if (line.status === 'PENDING') {
    return (
      <div className="inline-flex flex-nowrap items-center justify-end gap-2 shrink-0">
        <Button type="button" variant="primary" size="sm" onClick={() => submit('approveAdSpend')} disabled={submitting}>
          Approve
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={handleReject} disabled={submitting}>
          Reject
        </Button>
      </div>
    );
  }
  return (
    <span className="text-xs text-app-fg-muted">
      {line.status === 'REJECTED' && line.rejectionReason ? line.rejectionReason : '—'}
    </span>
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

interface AdSpendDayAccordionProps {
  groups: AdSpendGroup[];
  /** Show MB column inside expanded rows + on the header (HoM/admin only). */
  showMediaBuyerColumn: boolean;
  /** When true, per-line approve/reject buttons render (HoM/admin only). */
  canModerate: boolean;
  page: number;
  totalPages: number;
  /** Remix action URL for approve/reject intents. */
  actionUrl: string;
  /** Open a receipt/screenshot inside the parent modal. */
  onPreviewReceipt: (line: AdSpendGroupLine) => void;
}

export function AdSpendDayAccordion({
  groups,
  showMediaBuyerColumn,
  canModerate,
  page,
  totalPages,
  actionUrl,
  onPreviewReceipt,
}: AdSpendDayAccordionProps) {
  // Default to fully collapsed so long lists stay scannable.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  const lineColumns = useMemo(
    () => buildAdSpendLineColumns(canModerate, actionUrl, onPreviewReceipt),
    [canModerate, actionUrl, onPreviewReceipt],
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
        description="Use Add Expense to record today's ad spend lines in one go."
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {groups.map((g) => {
          const key = `${g.spendDate}::${g.mediaBuyerId}`;
          const isOpen = openKeys.has(key);
          return (
            <li
              key={key}
              className="rounded-lg border border-app-border bg-app-elevated overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-app-hover transition-colors"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <div className="text-left min-w-0">
                    <div className="font-medium text-app-fg truncate">
                      {formatDate(g.spendDate)}
                      {showMediaBuyerColumn && g.mediaBuyerName && (
                        <span className="text-app-fg-muted font-normal">
                          {' · '}
                          {g.mediaBuyerName}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-app-fg-muted">
                      {g.lineCount} line{g.lineCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold">
                    <NairaPrice amount={Number(g.totalAmount)} />
                  </span>
                  <StatusBadge status={g.rolledStatus} label={rolledStatusLabel(g.rolledStatus)} />
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
                        actionUrl={actionUrl}
                        onPreviewReceipt={onPreviewReceipt}
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
        <Pagination page={page} totalPages={totalPages} pageParam="gpage" />
      )}
    </div>
  );
}

interface LineCardMobileProps {
  line: AdSpendGroupLine;
  canModerate: boolean;
  actionUrl: string;
  onPreviewReceipt: (line: AdSpendGroupLine) => void;
}

function LineCardMobile({ line, canModerate, actionUrl, onPreviewReceipt }: LineCardMobileProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== 'idle';

  const submit = (intent: 'approveAdSpend' | 'rejectAdSpend', reason?: string) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('adSpendId', line.id);
    if (reason) fd.set('reason', reason);
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
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
        {PLATFORM_LABEL[line.platform]}
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
      {canModerate && line.status === 'PENDING' && (
        <div className="inline-flex flex-nowrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => submit('approveAdSpend')}
            disabled={submitting}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const reason = window.prompt('Reason for rejection (optional)') ?? undefined;
              submit('rejectAdSpend', reason || undefined);
            }}
            disabled={submitting}
          >
            Reject
          </Button>
        </div>
      )}
      {line.status === 'REJECTED' && line.rejectionReason && (
        <p className="text-xs text-danger-600">{line.rejectionReason}</p>
      )}
    </div>
  );
}
