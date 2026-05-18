/**
 * Reusable pulse blocks for deferred loader data: keep real layout (labels, cards, toolbars)
 * and replace only the values / chart regions until `secondary` resolves.
 */

import type { CompactTableColumn } from '~/components/ui/compact-table';

/** Single-line placeholder inside `CompactTable` cells (contrasts on row / card background). */
export function TableCellTextPulse({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 max-w-full rounded-md bg-app-border/85 dark:bg-app-border/70 animate-pulse ${className}`}
      aria-hidden
    />
  );
}

/** Stat tile values sit on `bg-app-hover`; use border-toned bars so the pulse reads as text/figures. */
export function StatValuePulse({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-[1.375rem] min-h-[1.375rem] rounded-md bg-app-border/85 dark:bg-app-border/70 animate-pulse ${className}`}
      aria-hidden
    />
  );
}

/**
 * Mirrors `OrdersChartView` (trend card, pie + bar grid) while deferred data streams.
 * Used on order list pages with chart toggle.
 */
export function OrdersChartViewShellSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 h-4 max-w-[14rem] rounded bg-app-hover animate-pulse" aria-hidden />
        <div className="h-72 w-full rounded-lg bg-app-hover/90 animate-pulse" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 h-4 max-w-[12rem] rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="flex justify-center py-6">
            <div className="h-44 w-44 rounded-full bg-app-hover animate-pulse" aria-hidden />
          </div>
        </div>
        <div className="card">
          <div className="mb-3 h-4 max-w-[10rem] rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-72 w-full rounded-lg bg-app-hover/90 animate-pulse" aria-hidden />
        </div>
      </div>
    </div>
  );
}

/** Build `CompactTable` columns with real headers and `TableCellTextPulse` cell bodies (loading shells). */
export type ShellPulseColumnSpec = {
  key: string;
  header: string;
  align?: 'right' | 'center';
  pulseClassName?: string;
};

export function shellPulsePlaceholderRows(prefix: string, rowCount: number): { id: string }[] {
  return Array.from({ length: rowCount }, (_, i) => ({ id: `__shell_${prefix}_${i}` }));
}

export function shellPulseCompactTableColumns(
  specs: ShellPulseColumnSpec[],
): CompactTableColumn<{ id: string }>[] {
  return specs.map((s) => ({
    key: s.key,
    header: s.header,
    align: s.align,
    render: () =>
      s.align === 'right' ? (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className={s.pulseClassName ?? 'w-[5.5rem]'} />
        </span>
      ) : s.align === 'center' ? (
        <span className="inline-flex w-full justify-center">
          <TableCellTextPulse className={s.pulseClassName ?? 'w-[5rem]'} />
        </span>
      ) : (
        <TableCellTextPulse className={s.pulseClassName ?? 'w-[7rem]'} />
      ),
  }));
}
