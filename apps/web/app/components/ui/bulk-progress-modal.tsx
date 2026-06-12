import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';

// ── Types ────────────────────────────────────────────────────────────

export interface BulkProgressState {
  /** Human-readable action label: "Moving orders", "Assigning closers", etc. */
  label: string;
  total: number;
  completed: number;
  failed: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  /** Optional per-item error messages (shown on complete with failures). */
  errors?: string[];
}

export const BULK_PROGRESS_IDLE: BulkProgressState = {
  label: '',
  total: 0,
  completed: 0,
  failed: 0,
  status: 'idle',
};

// ── Component ────────────────────────────────────────────────────────

interface BulkProgressModalProps {
  state: BulkProgressState;
  /** Called when the user clicks "Done" after completion — caller should reset state to idle. */
  onDone: () => void;
}

/**
 * Reusable modal that shows a progress bar for long-running bulk actions.
 *
 * Usage:
 * ```tsx
 * const [progress, setProgress] = useState(BULK_PROGRESS_IDLE);
 * // ... drive setProgress from your bulk loop
 * <BulkProgressModal state={progress} onDone={() => setProgress(BULK_PROGRESS_IDLE)} />
 * ```
 */
export function BulkProgressModal({ state, onDone }: BulkProgressModalProps) {
  const { label, total, completed, failed, status, errors } = state;
  const open = status === 'running' || status === 'complete' || status === 'error';
  const processed = completed + failed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const succeeded = completed;

  const barColor =
    status === 'complete' && failed === 0
      ? 'bg-success-500'
      : status === 'complete' || status === 'error'
        ? failed > 0
          ? 'bg-warning-500'
          : 'bg-danger-500'
        : 'bg-brand-500';

  const badgeClasses =
    status === 'complete' && failed === 0
      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
      : status === 'complete' && failed > 0
        ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
        : status === 'error'
          ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
          : 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400';

  const badgeLabel =
    status === 'complete' && failed === 0
      ? 'Done'
      : status === 'complete'
        ? 'Done with errors'
        : status === 'error'
          ? 'Error'
          : 'Processing';

  return (
    <Modal
      open={open}
      onClose={() => {
        // Only allow close when finished
        if (status !== 'running') onDone();
      }}
      maxWidth="max-w-sm"
      contentClassName="p-6 space-y-4"
      role="alertdialog"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-app-fg">{label}</h3>
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClasses}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Counter */}
      <p className="text-sm text-app-fg-muted">
        {processed} of {total}{status === 'running' ? '…' : ''}
        {' — '}
        <span className="text-success-600 dark:text-success-400">{succeeded} succeeded</span>
        {failed > 0 && <>, <span className="text-danger-600 dark:text-danger-400">{failed} failed</span></>}
      </p>

      {/* Progress bar */}
      <div className="h-2.5 w-full rounded-full bg-app-hover overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Percentage */}
      <p className="text-xs text-app-fg-muted text-right">{pct}%</p>

      {/* Error list (max 5) */}
      {errors && errors.length > 0 && status !== 'running' && (
        <div className="max-h-28 overflow-y-auto rounded-md border border-danger-200 bg-danger-50 p-2 dark:border-danger-800 dark:bg-danger-900/20">
          <ul className="space-y-0.5 text-xs text-danger-700 dark:text-danger-400">
            {errors.slice(0, 5).map((err, i) => (
              <li key={i}>• {err}</li>
            ))}
            {errors.length > 5 && (
              <li className="text-app-fg-muted">…and {errors.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Done button */}
      {status !== 'running' && (
        <div className="flex justify-end pt-1">
          <Button variant="primary" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
