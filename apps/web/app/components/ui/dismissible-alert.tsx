/**
 * @deprecated Use PageNotification from ~/components/ui/page-notification for new code.
 * PageNotification provides progress bar, pause/resume, and consistent styling.
 */
import { useEffect, useRef, useCallback } from 'react';

type Variant = 'danger' | 'warning' | 'info';

export interface DismissibleAlertProps {
  message: string;
  variant?: Variant;
  durationMs?: number;
  onDismiss: () => void;
  className?: string;
}

const variantClasses: Record<Variant, { container: string; text: string; bar: string }> = {
  danger: {
    container: 'bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50',
    text: 'text-danger-700 dark:text-danger-500',
    bar: 'bg-danger-500/80',
  },
  warning: {
    container: 'bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50',
    text: 'text-warning-800 dark:text-warning-200',
    bar: 'bg-warning-500/80',
  },
  info: {
    container: 'bg-info-50 dark:bg-info-700/20 border border-info-200 dark:border-info-700/50',
    text: 'text-info-700 dark:text-info-500',
    bar: 'bg-info-500/80',
  },
};

export function DismissibleAlert({
  message,
  variant = 'danger',
  durationMs = 6000,
  onDismiss,
  className = '',
}: DismissibleAlertProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const handleDismiss = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onDismissRef.current();
  }, []);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onDismissRef.current();
    }, durationMs);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [durationMs]);

  const classes = variantClasses[variant];

  return (
    <div
      className={`rounded-lg overflow-hidden ${classes.container} ${className}`}
      role="alert"
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <p className={`text-sm flex-1 min-w-0 ${classes.text}`}>{message}</p>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded-md text-app-fg-muted hover:text-app-fg hover:bg-app-hover/50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-app-border focus:ring-offset-app-canvas"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="h-1 w-full bg-surface-200/50 dark:bg-surface-700/50 overflow-hidden">
        <div
          className={`h-full origin-left ${classes.bar}`}
          style={{
            animation: `dismissible-alert-shrink ${durationMs}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}
