import { useState } from 'react';
import { formatActivityDescription } from '~/lib/format-activity';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { StatRow, StatRowGroup } from '~/components/ui/stat-row';
import type { StaffPayoutEstimate, UserAuditEntry } from './types';

function auditActivityRowKey(entry: UserAuditEntry, position: number): string {
  return `${entry.tableName}-${entry.id}-${entry.createdAt}-${position}`;
}

/** Live payroll estimate card — data from `hr.previewPayout` (deferred `/api/hr-user-detail-earnings`). */
export function UserDetailEarningsOutlookCard({
  heading,
  periodLabel,
  preview,
}: {
  heading: string;
  periodLabel: string;
  preview: StaffPayoutEstimate | null;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-app-border">
        <h3 className="text-sm font-semibold text-app-fg">{heading}</h3>
        <p className="text-xs text-app-fg-muted mt-0.5">{periodLabel}</p>
      </div>
      <div className="p-4">
        {!preview ? (
          <EmptyState
            title="No estimate yet"
            description="If this persists, refresh the tab or contact HR."
            variant="inline"
            bordered={false}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-app-fg-muted">
              Plan: <span className="text-app-fg font-medium">{preview.planName}</span>
            </p>
            <StatRowGroup divided>
              <StatRow label="Attributed orders (period)" value={preview.totalOrders.toLocaleString()} />
              <StatRow label="Delivered" value={preview.deliveredCount.toLocaleString()} />
              <StatRow label="Returns" value={preview.returnedCount.toLocaleString()} />
              <StatRow label="Delivery rate" value={`${preview.deliveryRate.toFixed(1)}%`} />
              <StatRow label="Base salary (estimate)" value="" amount={preview.baseSalary} variant="subtotal" />
              <StatRow label="Performance bonus (estimate)" value="" amount={preview.performanceBonus} />
              {preview.penalties > 0 ? (
                <StatRow
                  label="Return penalties (estimate)"
                  value=""
                  amount={-Math.abs(preview.penalties)}
                  variant="deduction"
                />
              ) : null}
              {preview.clawbacks > 0 ? (
                <StatRow
                  label="Pending clawbacks"
                  value=""
                  amount={-Math.abs(preview.clawbacks)}
                  variant="deduction"
                />
              ) : null}
              <StatRow
                label="Estimated net (before payroll add-ons)"
                value=""
                amount={preview.totalPayout}
                variant="total"
              />
            </StatRowGroup>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Activity / audit log tab — paginated 10/page client-side. Loader returns up to 50 entries
 * (UserAuditEntry[]); we slice in-memory because the volume is small and avoiding a server
 * round-trip per page keeps the tab responsive.
 */
export function UserDetailActivityTabContent({ entries }: { entries: UserAuditEntry[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paged = entries.slice(startIdx, startIdx + pageSize);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-app-fg">Activity</h3>
        <span className="text-xs text-app-fg-muted">{entries.length} entries</span>
      </div>
      {entries.length > 0 ? (
        <>
          <div className="space-y-2">
            {paged.map((entry, pageIndex) => (
              <div key={auditActivityRowKey(entry, startIdx + pageIndex)} className="flex items-start gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-app-fg truncate">{formatActivityDescription(entry)}</p>
                  <p className="text-app-fg-muted text-mini mt-0.5">
                    {new Date(entry.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="pt-2 border-t border-app-border flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-app-fg-muted">
                Showing {startIdx + 1}–{Math.min(startIdx + pageSize, entries.length)} of {entries.length}
              </p>
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                pageSize={pageSize}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-app-fg-muted">No activity recorded yet</p>
      )}
    </div>
  );
}
