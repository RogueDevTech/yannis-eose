import { useEffect, useState } from 'react';

export type DismissibleMessageCardVariant = 'notification' | 'error';

export interface DismissibleMessageCardProps {
  variant: DismissibleMessageCardVariant;
  title: string;
  message: string;
  onDismiss: () => void;
  durationMs?: number;
  className?: string;
}

const WARNING_ICON = (
  <svg className="w-5 h-5 text-warning-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const DEFAULT_DURATION_MS = 10_000;

export function DismissibleMessageCard({
  variant,
  title,
  message,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
  className = '',
}: DismissibleMessageCardProps) {
  const isError = variant === 'error';
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const [countdown, setCountdown] = useState(totalSeconds);

  useEffect(() => {
    if (!isError) return;
    if (countdown <= 0) {
      onDismiss();
      return;
    }
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [isError, countdown, onDismiss]);

  const progressPercent = (countdown / totalSeconds) * 100;

  return (
    <div
      className={`rounded-lg overflow-hidden bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        {WARNING_ICON}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-warning-800 dark:text-warning-300">{title}</p>
          <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">{message}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="text-sm font-medium px-3 py-1.5 rounded-md bg-warning-200/60 dark:bg-warning-800/50 text-warning-800 dark:text-warning-200 hover:bg-warning-300/70 dark:hover:bg-warning-700/50 focus:outline-none focus:ring-2 focus:ring-warning-500 focus:ring-offset-1 dark:focus:ring-offset-surface-900"
              aria-label="Dismiss"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      {isError && (
        <div
          className="mt-3 w-full h-1.5 bg-surface-200/50 dark:bg-surface-700/50 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={totalSeconds - countdown}
          aria-valuemin={0}
          aria-valuemax={totalSeconds}
          aria-label="Auto-dismiss countdown"
        >
          <div
            className="h-full bg-warning-500/80 rounded-full transition-all duration-1000 ease-linear origin-left"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}
