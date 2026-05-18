import { useEffect, useRef, useState, useCallback } from 'react';

export type PageNotificationVariant = 'error' | 'success' | 'warning' | 'info';

export interface PageNotificationProps {
  variant: PageNotificationVariant;
  message: string;
  title?: string;
  /** Default: 5000 for error, 5000 for others. Override per call. */
  durationMs?: number;
  onDismiss: () => void;
  className?: string;
}

const DEFAULT_DURATION_MS = 5000;
const TICK_MS = 100;

const variantClasses: Record<
  PageNotificationVariant,
  { container: string; text: string; title: string; bar: string }
> = {
  error: {
    container: 'bg-danger-50 dark:bg-transparent border border-danger-200 dark:border-danger-500/60',
    text: 'text-danger-700 dark:text-danger-300',
    title: 'text-danger-800 dark:text-danger-200',
    bar: 'bg-danger-500/80',
  },
  success: {
    container: 'bg-success-50 dark:bg-transparent border border-success-200 dark:border-success-500/60',
    text: 'text-success-700 dark:text-success-300',
    title: 'text-success-800 dark:text-success-200',
    bar: 'bg-success-500/80',
  },
  warning: {
    container: 'bg-warning-50 dark:bg-transparent border border-warning-200 dark:border-warning-500/60',
    text: 'text-warning-800 dark:text-warning-300',
    title: 'text-warning-900 dark:text-warning-200',
    bar: 'bg-warning-500/80',
  },
  info: {
    container: 'bg-info-50 dark:bg-transparent border border-info-200 dark:border-info-500/60',
    text: 'text-info-700 dark:text-info-300',
    title: 'text-info-800 dark:text-info-200',
    bar: 'bg-info-500/80',
  },
};

export function PageNotification({
  variant,
  message,
  title,
  durationMs = DEFAULT_DURATION_MS,
  onDismiss,
  className = '',
}: PageNotificationProps) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const [paused, setPaused] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const handleDismiss = useCallback(() => {
    onDismissRef.current();
  }, []);

  useEffect(() => {
    if (paused || remainingMs <= 0) return;
    const id = setInterval(() => {
      setRemainingMs((prev) => {
        const next = Math.max(0, prev - TICK_MS);
        if (next <= 0) {
          onDismissRef.current();
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused, remainingMs]);

  const progressPercent = remainingMs <= 0 ? 0 : (remainingMs / durationMs) * 100;
  const classes = variantClasses[variant];
  const isError = variant === 'error';

  return (
    <div
      className={`rounded-lg overflow-hidden ${classes.container} ${className}`}
      role="alert"
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {title && (
            <p className={`text-sm font-semibold ${classes.title} mb-0.5`}>{title}</p>
          )}
          <p className={`text-sm ${classes.text}`}>{message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="p-1.5 rounded-md text-app-fg-muted hover:text-app-fg hover:bg-app-hover/50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-app-border focus:ring-offset-app-canvas"
            aria-label={paused ? 'Resume countdown' : 'Pause countdown'}
          >
            {paused ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-md text-app-fg-muted hover:text-app-fg hover:bg-app-hover/50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-app-border focus:ring-offset-app-canvas"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div
        className="h-1 w-full bg-surface-200/50 dark:bg-surface-700/50 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progressPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Time until message closes"
      >
        <div
          className={`h-full transition-[width] duration-100 ease-linear ${classes.bar}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
