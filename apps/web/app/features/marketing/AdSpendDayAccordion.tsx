import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
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
}

export function AdSpendDayAccordion({
  groups,
  showMediaBuyerColumn,
  canModerate,
  page,
  totalPages,
  actionUrl,
}: AdSpendDayAccordionProps) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    // Default-expand the first group on a fresh load — saves one click for the
    // common case (MB checking what they just submitted).
    return new Set(groups[0] ? [`${groups[0].spendDate}::${groups[0].mediaBuyerId}`] : []);
  });

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
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="table-header !py-2">Campaign</th>
                          <th className="table-header !py-2">Product</th>
                          <th className="table-header !py-2">Platform</th>
                          <th className="table-header !py-2 text-right">Amount</th>
                          <th className="table-header !py-2">Ad</th>
                          <th className="table-header !py-2">Screenshot</th>
                          <th className="table-header !py-2">Status</th>
                          {canModerate && <th className="table-header !py-2">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.lines.map((line) => (
                          <LineRow
                            key={line.id}
                            line={line}
                            canModerate={canModerate}
                            actionUrl={actionUrl}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden divide-y divide-app-border">
                    {g.lines.map((line) => (
                      <LineCardMobile
                        key={line.id}
                        line={line}
                        canModerate={canModerate}
                        actionUrl={actionUrl}
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

interface LineRowProps {
  line: AdSpendGroupLine;
  canModerate: boolean;
  actionUrl: string;
}

function LineRow({ line, canModerate, actionUrl }: LineRowProps) {
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

  return (
    <tr className="border-t border-app-border">
      <td className="px-4 py-2">
        {line.campaignName ?? '—'}
      </td>
      <td className="px-4 py-2">
        {line.productId ? (
          <Link
            to={`/admin/products/${line.productId}`}
            className="text-brand-500 hover:text-brand-600"
          >
            {line.productName ?? '—'}
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2">{PLATFORM_LABEL[line.platform]}</td>
      <td className="px-4 py-2 text-right font-medium">
        <NairaPrice amount={Number(line.spendAmount)} />
      </td>
      <td className="px-4 py-2">
        {line.adUrl ? (
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
        )}
      </td>
      <td className="px-4 py-2">
        <a
          href={line.screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-500 hover:text-brand-600 underline"
        >
          View
        </a>
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={line.status} />
      </td>
      {canModerate && (
        <td className="px-4 py-2">
          {line.status === 'PENDING' ? (
            <div className="flex gap-2">
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
                onClick={handleReject}
                disabled={submitting}
              >
                Reject
              </Button>
            </div>
          ) : (
            <span className="text-xs text-app-fg-muted">
              {line.status === 'REJECTED' && line.rejectionReason
                ? line.rejectionReason
                : '—'}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

function LineCardMobile({ line, canModerate, actionUrl }: LineRowProps) {
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
      <div className="flex flex-wrap gap-3 text-xs">
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
        <a
          href={line.screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-500 hover:text-brand-600 underline"
        >
          View screenshot
        </a>
      </div>
      {canModerate && line.status === 'PENDING' && (
        <div className="flex gap-2">
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
