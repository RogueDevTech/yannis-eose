import { useCallback, useMemo, useRef, type ReactNode } from 'react';

import { useHasHorizontalOverflow } from '~/hooks/useHasHorizontalOverflow';

export type OverviewStatStripItem = {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  title?: string;
  /** When true, value is not forced to text-xl font-bold (e.g. badges). */
  plainValue?: boolean;
};

const SCROLL_DELTA = 280;

const labelClass = 'text-xs font-medium text-app-fg-muted uppercase tracking-wider';
const valueClass = 'text-xl font-bold mt-0.5';

export function OverviewStatStripSkeleton({
  count,
  labels,
  tileClassName = '',
}: {
  count: number;
  /**
   * Optional real labels for each tile. When provided, the labels render as
   * real text and ONLY the value below pulses (App Shell pattern). When
   * omitted, both label and value pulse — the legacy behaviour.
   */
  labels?: string[];
  tileClassName?: string;
}) {
  const tiles = Array.from({ length: count });
  const hasLabels = !!labels && labels.length > 0;
  return (
    <div className="card !p-4">
      <div className="flex flex-nowrap gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        {tiles.map((_, i) => (
          <div
            key={i}
            className={`shrink-0 min-w-[5rem] text-center px-2 py-1.5 rounded-lg bg-app-hover/50 ${tileClassName}`}
          >
            {hasLabels ? (
              <div className={labelClass}>{labels[i] ?? ''}</div>
            ) : (
              <div className="h-3 w-14 mx-auto rounded bg-app-hover animate-pulse" />
            )}
            <div className="h-6 w-8 mx-auto rounded bg-app-hover mt-1.5 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

type OverviewStatStripProps = {
  items: OverviewStatStripItem[];
  /** @default true */
  showScrollControls?: boolean;
  className?: string;
  /** Appended to each tile (e.g. min-w-[6rem]) */
  tileClassName?: string;
  /** Omit outer `card` wrapper (use inside an existing card). */
  embedded?: boolean;
};

export function OverviewStatStrip({
  items,
  showScrollControls = true,
  className,
  tileClassName = '',
  embedded = false,
}: OverviewStatStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const overflowContentKey = useMemo(
    () =>
      items
        .map((item, i) => {
          const v = item.value;
          const vPart =
            typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : `n${i}`;
          return `${item.label}:${vPart}`;
        })
        .join('|'),
    [items],
  );

  const hasHorizontalOverflow = useHasHorizontalOverflow(scrollRef, overflowContentKey);

  const tileBase = ['shrink-0', 'text-center', 'px-2', 'py-1.5', 'rounded-lg', 'bg-app-hover', tileClassName || 'min-w-[5rem]']
    .join(' ');

  const scrollButtons = showScrollControls && hasHorizontalOverflow ? (
    <div className="hidden md:flex shrink-0 items-center gap-0.5 sm:gap-1.5 self-center">
      <button
        type="button"
        onClick={() => scrollBy(-SCROLL_DELTA)}
        className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
        aria-label="Scroll metrics left"
      >
        <svg
          className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => scrollBy(SCROLL_DELTA)}
        className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
        aria-label="Scroll metrics right"
      >
        <svg
          className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  ) : null;

  const stripRow = (
    <div className="flex items-center gap-1.5 min-w-0">
      <div ref={scrollRef} className="flex flex-1 min-w-0 flex-nowrap gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        {items.map((item, i) => (
          <div key={i} className={tileBase} title={item.title}>
            <p className={labelClass}>{item.label}</p>
            {item.plainValue ? (
              <div className="mt-0.5 flex justify-center">{item.value}</div>
            ) : (
              <p className={`${valueClass} ${item.valueClassName ?? 'text-app-fg'}`}>{item.value}</p>
            )}
          </div>
        ))}
      </div>
      {scrollButtons}
    </div>
  );

  if (embedded) {
    return <div className={className}>{stripRow}</div>;
  }

  const outer = ['card', '!p-4', className].filter(Boolean).join(' ');
  return <div className={outer}>{stripRow}</div>;
}
