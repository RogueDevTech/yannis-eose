export interface LiveIndicatorProps {
  isConnected: boolean;
  showGreen: boolean;
}

export function LiveIndicator({ isConnected, showGreen }: LiveIndicatorProps) {
  const title = showGreen
    ? 'Update received'
    : isConnected
      ? 'Live – real-time updates'
      : 'Reconnecting';

  return (
    <span
      className="inline-flex min-h-[2rem] items-center gap-1.5 rounded-full bg-white/70 dark:bg-surface-800/90 backdrop-blur-md px-2 py-0.5 text-xs font-semibold text-surface-900 dark:text-surface-100 shadow-sm"
      aria-live="polite"
      title={title}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          showGreen
            ? 'bg-success-500 ring-2 ring-success-500/30'
            : isConnected
              ? 'bg-warning-500 animate-live-blink'
              : 'bg-surface-400 dark:bg-surface-500'
        }`}
        aria-hidden
      />
      <span>{isConnected ? (showGreen ? 'Updated' : 'Live') : 'Reconnecting'}</span>
    </span>
  );
}
