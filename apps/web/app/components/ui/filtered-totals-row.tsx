import { formatNaira } from '~/lib/format-amount';

interface FilteredTotalsRowProps {
  /** Total amount across all filtered results (not just visible page). */
  totalAmount: number;
  /** Number of records matching the current filter. */
  recordCount: number;
  /** Label for the record count (defaults to "record"/"records"). */
  recordLabel?: string;
  /** Extra items to display after the amount and count. */
  extra?: React.ReactNode;
}

export function FilteredTotalsRow({
  totalAmount,
  recordCount,
  recordLabel,
  extra,
}: FilteredTotalsRowProps) {
  if (recordCount <= 0) return null;

  const label = recordLabel
    ?? (recordCount === 1 ? 'record' : 'records');

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 bg-brand-50 dark:bg-brand-950/40 border-b-2 border-brand-200 dark:border-brand-800">
      <span className="text-sm font-semibold text-brand-700 dark:text-brand-300 tabular-nums">
        {formatNaira(totalAmount)}
      </span>
      <span className="text-xs text-brand-600/70 dark:text-brand-400/70">
        {recordCount} {label}
      </span>
      {extra}
    </div>
  );
}
