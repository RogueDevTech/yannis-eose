import type { ReactNode } from 'react';

/** Compact inline dot separator for combining two values in a single column/cell. */
export function DotSeparator({ className }: { className?: string }) {
  return (
    <span
      className={`text-app-fg-muted text-[0.6em] mx-1 ${className ?? ''}`}
      aria-hidden
    >
      ○
    </span>
  );
}

/**
 * Two values in a single table cell, cleanly aligned on a 3-column inline grid
 * so the left value, dot, and right value each form a consistent vertical line
 * across rows.
 */
export function DualValue({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-grid grid-cols-[auto_auto_auto] items-baseline tabular-nums ${className ?? ''}`}>
      <span className="text-right">{left}</span>
      <DotSeparator />
      <span className="text-left">{right}</span>
    </span>
  );
}
