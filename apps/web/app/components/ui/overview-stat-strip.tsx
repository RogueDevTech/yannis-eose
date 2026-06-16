import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@remix-run/react';

import { useHasHorizontalOverflow } from '~/hooks/useHasHorizontalOverflow';

/** Recursively serialize a ReactNode into a stable comparison key (primitives only). */
function stableValueKey(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(stableValueKey).join('|');
  if (typeof node === 'object' && 'props' in (node as object)) {
    return stableValueKey((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

export type OverviewStatStripItem = {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  title?: string;
  /** When true, value is not forced to text-xl font-bold (e.g. badges). */
  plainValue?: boolean;
  /** Extra classes on the individual tile (e.g. `text-left` to override centering). */
  itemClassName?: string;
  /**
   * When set, the tile becomes a navigation link to this URL (e.g. a status
   * filter like `?status=CANCELLED`). Tiles without `to` stay plain display.
   */
  to?: string;
  /** Highlight this tile as the currently-selected filter. */
  active?: boolean;
  /** Fires on click — use to update local state instantly before navigation completes. */
  onClick?: () => void;
};

/** Subtle clickable affordance — no layout/colour change, just press feedback. */
const clickableTileClass =
  'cursor-pointer transition-opacity hover:opacity-80 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/** Active tile — border-only highlight, same background as siblings. */
const activeTileClass =
  'ring-2 ring-inset ring-brand-500 dark:ring-brand-400';

const SCROLL_DELTA = 280;

const labelClass = 'text-xs font-medium text-app-fg-muted uppercase tracking-wider';
const valueClass = 'text-lg font-bold leading-tight md:mt-0.5 md:text-xl';

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
    <div className="card !p-0 overflow-hidden">
      <div className="overflow-x-auto scrollbar-hide px-[0.9rem] py-[0.9rem]">
        <div className="flex w-max min-w-full flex-nowrap gap-2 pb-0.5">
          {tiles.map((_, i) => (
            <div
              key={i}
              className={`shrink-0 min-w-[10rem] rounded-lg bg-app-hover/50 px-2 py-1.5 text-center md:min-w-[5rem] ${tileClassName}`}
            >
              {hasLabels ? (
                <div>
                  <div className={`truncate ${labelClass}`}>
                    {labels[i] ?? ''}
                  </div>
                  <div className="mt-1.5 h-6 rounded bg-app-hover animate-pulse md:mx-auto md:w-8" />
                </div>
              ) : (
                <>
                  <div className="mx-auto h-3 w-14 rounded bg-app-hover animate-pulse" />
                  <div className="mt-1.5 h-6 rounded bg-app-hover animate-pulse md:mx-auto md:w-8" />
                </>
              )}
            </div>
          ))}
        </div>
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
  /**
   * On mobile, render a wrapping grid (3 columns) instead of the horizontal
   * scroll strip. Better for strips with ≤6 fixed items where the user
   * should see everything at a glance. Desktop layout is unchanged.
   */
  mobileGrid?: boolean;
  /**
   * Wrap tiles to new lines on desktop instead of scrolling horizontally.
   * Useful for strips with many dynamic items (e.g. per-product breakdowns).
   */
  wrap?: boolean;
  /**
   * Arms per-item change detection: while true, a tile whose value changes
   * between renders briefly shows an up-arrow indicator. Driven by the socket
   * `showGreen` state from `useLiveIndicator` so background filter changes
   * don't trigger the arrow.
   */
  liveFlash?: boolean;
  /**
   * When true, each tile renders its label but replaces the value with a
   * skeleton pulse bar. Used as Suspense/deferred-loading fallback so the
   * strip layout stays mounted while data streams in.
   */
  loading?: boolean;
};

/** Tiny green up-arrow shown beside a value that just changed. */
function LiveFlashArrow() {
  return (
    <svg
      className="inline-block ml-1 h-3.5 w-3.5 text-success-500 animate-live-flash-arrow"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.573a.75.75 0 01-1.08-1.04l5.25-5.25a.75.75 0 011.08 0l5.25 5.25a.75.75 0 11-1.08 1.04l-3.96-3.961V16.25A.75.75 0 0110 17z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const CHANGE_FLASH_MS = 1500;

export function OverviewStatStrip({
  items,
  showScrollControls = true,
  className,
  tileClassName = '',
  embedded = false,
  mobileGrid = false,
  wrap = false,
  liveFlash = false,
  loading = false,
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

  const prevKeysRef = useRef<Map<number, string>>(new Map());
  const isFirstRenderRef = useRef(true);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [changedAt, setChangedAt] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const newlyChanged: number[] = [];
    items.forEach((item, i) => {
      const key = stableValueKey(item.value);
      const prev = prevKeysRef.current.get(i);
      if (!isFirstRenderRef.current && prev !== undefined && prev !== key && liveFlash) {
        newlyChanged.push(i);
      }
      prevKeysRef.current.set(i, key);
    });
    isFirstRenderRef.current = false;

    if (newlyChanged.length === 0) return;

    const stamp = Date.now();
    setChangedAt((prev) => {
      const next = new Map(prev);
      newlyChanged.forEach((i) => next.set(i, stamp));
      return next;
    });
    newlyChanged.forEach((i) => {
      const existing = timeoutsRef.current.get(i);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setChangedAt((prev) => {
          if (prev.get(i) !== stamp) return prev;
          const next = new Map(prev);
          next.delete(i);
          return next;
        });
        timeoutsRef.current.delete(i);
      }, CHANGE_FLASH_MS);
      timeoutsRef.current.set(i, t);
    });
  }, [items, liveFlash]);

  useEffect(
    () => () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current.clear();
    },
    [],
  );

  const valueSkeleton = <div className="mt-1 h-6 w-10 rounded bg-app-hover/70 animate-pulse md:mx-auto" />;

  const tileBase = [
    'shrink-0',
    'rounded-lg',
    'bg-app-hover',
    'px-2',
    'py-1.5',
    'min-w-[10rem]',
    'md:min-w-[5rem]',
    'text-center',
    tileClassName,
  ]
    .filter(Boolean)
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

  const gridTile = [
    'rounded-lg',
    'bg-app-hover',
    'px-3',
    'py-1.5',
    'text-center',
    'min-w-0',
    'overflow-hidden',
    tileClassName,
  ].filter(Boolean).join(' ');

  const mobileGridContent = mobileGrid ? (
    <div className="md:hidden">
      <div
        className="gap-1.5 px-1.5 py-1.5"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(8.5rem, 100%), 1fr))' }}
      >
      {items.map((item, i) => {
        const stamp = changedAt.get(i);
        const inner = (
          <>
            <p className="truncate text-micro font-medium text-app-fg-muted uppercase tracking-wider">{item.label}</p>
            {loading ? (
              valueSkeleton
            ) : item.plainValue ? (
              <div className="mt-0.5 flex items-center justify-center">
                {item.value}
                {stamp !== undefined && <LiveFlashArrow key={stamp} />}
              </div>
            ) : (
              <p
                className={`mt-0.5 truncate text-lg font-bold leading-tight ${item.valueClassName ?? 'text-app-fg'}`}
              >
                {item.value}
                {stamp !== undefined && <LiveFlashArrow key={stamp} />}
              </p>
            )}
          </>
        );
        const activeClass = item.active ? activeTileClass : '';
        const itemCls = item.itemClassName ?? '';
        return item.to ? (
          <Link key={i} to={item.to} onClick={item.onClick} className={`${gridTile} ${clickableTileClass} ${activeClass} ${itemCls}`} title={item.title}>
            {inner}
          </Link>
        ) : item.onClick ? (
          <button key={i} type="button" onClick={item.onClick} className={`${gridTile} ${clickableTileClass} ${activeClass} ${itemCls} text-center`} title={item.title}>
            {inner}
          </button>
        ) : (
          <div key={i} className={`${gridTile} ${activeClass} ${itemCls}`} title={item.title}>
            {inner}
          </div>
        );
      })}
      </div>
    </div>
  ) : null;

  const stripContent = (
    <div ref={scrollRef} className={`flex-1 min-w-0 ${wrap ? '' : 'overflow-x-auto scrollbar-hide'} px-[0.9rem] py-[0.9rem] ${mobileGrid ? 'hidden md:block' : ''}`}>
      <div className={`flex ${wrap ? 'flex-wrap' : 'w-max min-w-full flex-nowrap'} gap-2 pb-0.5`}>
        {items.map((item, i) => {
          const stamp = changedAt.get(i);
          const inner = (
            <div>
              <p className={`truncate ${labelClass}`}>{item.label}</p>
              {loading ? (
                valueSkeleton
              ) : item.plainValue ? (
                <div className="mt-0.5 flex items-center justify-center">
                  {item.value}
                  {stamp !== undefined && <LiveFlashArrow key={stamp} />}
                </div>
              ) : (
                <p
                  className={`mt-0.5 ${valueClass} ${item.valueClassName ?? 'text-app-fg'}`}
                >
                  {item.value}
                  {stamp !== undefined && <LiveFlashArrow key={stamp} />}
                </p>
              )}
            </div>
          );
          const activeClass = item.active ? activeTileClass : '';
          const itemCls = item.itemClassName ?? '';
          return item.to ? (
            <Link key={i} to={item.to} onClick={item.onClick} className={`${tileBase} ${clickableTileClass} ${activeClass} ${itemCls}`} title={item.title}>
              {inner}
            </Link>
          ) : item.onClick ? (
            <button key={i} type="button" onClick={item.onClick} className={`${tileBase} ${clickableTileClass} ${activeClass} ${itemCls} text-left`} title={item.title}>
              {inner}
            </button>
          ) : (
            <div key={i} className={`${tileBase} ${activeClass} ${itemCls}`} title={item.title}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className={className}>
        {mobileGridContent}
        <div className={`flex items-center gap-1.5 min-w-0 ${mobileGrid ? 'hidden md:flex' : ''}`}>
          {stripContent}
          {scrollButtons}
        </div>
      </div>
    );
  }

  const outer = ['card', '!p-0', 'overflow-hidden', className].filter(Boolean).join(' ');
  return (
    <div className={outer}>
      {mobileGridContent}
      <div className={`flex items-center gap-1.5 min-w-0 ${mobileGrid ? 'hidden md:flex' : ''}`}>
        {stripContent}
        {scrollButtons ? <div className="hidden md:flex shrink-0 pr-[0.9rem]">{scrollButtons}</div> : null}
      </div>
    </div>
  );
}
