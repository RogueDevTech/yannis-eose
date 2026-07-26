import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@remix-run/react';

import { useHasHorizontalOverflow } from '~/hooks/useHasHorizontalOverflow';
import { useResolveFilterHref } from '~/hooks/useFilterPreferences';

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
  label: ReactNode;
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

/** Active matrix cell: background fill only (no border ring). */
const activeMatrixTileClass = 'relative z-[1] rounded-lg bg-app-hover';
const SCROLL_DELTA = 280;

const labelClass = 'text-xs font-medium text-app-fg-muted uppercase tracking-wider';
const valueClass = 'text-lg font-bold leading-tight md:mt-0.5 md:text-xl';

type MatrixCols = 1 | 2 | 3 | 4 | 5;

/**
 * Auto column count for matrix strips, scored per item length so pages adapt:
 * - ≤5 items → exact match (one row)
 * - more items → prefer even fills / fuller last rows; avoid orphans and
 *   sparse tails (e.g. 7 → 4+3 on a shared 4-col track, not 5+2)
 */
export function resolveMatrixCols(count: number, explicit?: MatrixCols): MatrixCols {
  if (explicit) return explicit;
  if (count <= 1) return 1;
  if (count <= 5) return count as MatrixCols;

  // Prefer 4 cols when it fits cleanly (7–8 → two rows of four).
  const candidates = [4, 3, 5, 2] as const;
  let best: MatrixCols = 4;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const cols of candidates) {
    if (cols > count) continue;
    const rem = count % cols;
    const lastRowLen = rem === 0 ? cols : rem;
    const empty = cols - lastRowLen;
    const rows = Math.ceil(count / cols);
    const lastFill = lastRowLen / cols;

    let score = 0;
    // Perfect short grids win; tall 2-col stacks should lose to fuller 4/5 grids.
    if (rem === 0) score += rows <= 3 ? 80 : 18;
    score -= empty * 22;
    if (lastRowLen === 1) score -= 90;
    if (lastFill >= 0.6) score += 28;
    else if (lastFill >= 0.5) score += 12;
    score -= rows * 14;
    if (cols === 4) score += 10;
    else if (cols === 3) score += 6;
    else if (cols === 5) score += 4;

    if (score > bestScore) {
      bestScore = score;
      best = cols;
    }
  }

  return best;
}

/**
 * Keep every row on the same column track so vertical dividers align.
 * Only a lone last cell spans full width (avoids a tiny orphan tile).
 */
function rowMatrixCols(baseCols: MatrixCols, rowLen: number): MatrixCols {
  if (rowLen < 1) return 1;
  if (rowLen === 1 && baseCols > 1) return 1;
  return baseCols;
}

/** From `sm` up, show the intended column count (no early wrap for short strips). */
function matrixColsClass(cols: MatrixCols): string {
  if (cols === 1) return 'grid-cols-1';
  if (cols === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (cols === 3) return 'grid-cols-1 sm:grid-cols-3';
  if (cols === 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
  // Five across needs width; stack → 2 → 5 (skip a 3-col band that orphans cells).
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5';
}

export function OverviewStatStripSkeleton({
  count,
  labels,
  tileClassName = '',
  matrixCols: matrixColsProp,
}: {
  count: number;
  /**
   * Optional real labels for each cell. When provided, the labels render as
   * real text and ONLY the value pulses (App Shell pattern). When omitted,
   * both label and value pulse.
   */
  labels?: string[];
  tileClassName?: string;
  /** Columns for the matrix skeleton (auto from `count` when omitted). */
  matrixCols?: MatrixCols;
}) {
  const matrixCols = resolveMatrixCols(count, matrixColsProp);
  const cells = Array.from({ length: count });
  const hasLabels = !!labels && labels.length > 0;
  const rowCount = Math.ceil(count / matrixCols);

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="text-sm">
        {Array.from({ length: rowCount }, (_, rowIdx) => {
          const start = rowIdx * matrixCols;
          const rowCells = cells.slice(start, start + matrixCols);
          const rowCols = rowMatrixCols(matrixCols, rowCells.length);
          const colsClass = matrixColsClass(rowCols);
          return (
            <div
              key={`row-${rowIdx}`}
              className={`grid ${colsClass} divide-y divide-app-border sm:divide-y-0 sm:divide-x sm:divide-app-border ${
                rowIdx > 0 ? 'border-t border-app-border' : ''
              }`}
            >
              {rowCells.map((_, colIdx) => {
                const i = start + colIdx;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between gap-3 px-4 sm:px-3 py-2.5 min-w-0 ${tileClassName}`}
                  >
                    {hasLabels ? (
                      <span className="text-xs text-app-fg-muted shrink-0 pr-3">{labels[i] ?? ''}</span>
                    ) : (
                      <span className="h-3 w-16 rounded bg-app-hover animate-pulse shrink-0" />
                    )}
                    <span className="h-4 w-12 rounded bg-app-hover/70 animate-pulse" />
                  </div>
                );
              })}
            </div>
          );
        })}
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
   * Ignored when `variant="matrix"`.
   */
  mobileGrid?: boolean;
  /** Number of columns in the mobile grid (default 2). Use 1 for strips
   *  with long labels that would truncate in a 2-col layout. */
  mobileGridCols?: 1 | 2 | 3;
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
  /**
   * `matrix` (default): dense key/value cells in one bordered card (label left, value right).
   * `tiles`: legacy padded metric tiles in a scroll/grid strip.
   */
  variant?: 'tiles' | 'matrix';
  /**
   * Columns for `variant="matrix"`. Omit to auto-fit from `items.length`
   * (≤5 = one row; longer strips pick a balanced grid). Rows share one column
   * track so dividers stay aligned; a lone last cell spans full width.
   */
  matrixCols?: MatrixCols;
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
  mobileGridCols = 2,
  wrap = false,
  liveFlash = false,
  loading = false,
  variant = 'matrix',
  matrixCols: matrixColsProp,
}: OverviewStatStripProps) {
  const matrixCols = resolveMatrixCols(items.length, matrixColsProp);
  const resolveHref = useResolveFilterHref();
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
          const lPart = typeof item.label === 'string' ? item.label : `l${i}`;
          return `${lPart}:${vPart}`;
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
  const matrixValueSkeleton = <div className="h-4 w-16 rounded bg-app-hover/70 animate-pulse" />;

  if (variant === 'matrix') {
    const rowCount = Math.ceil(items.length / matrixCols);
    const matrixBody = (
      <div className="text-sm">
        {Array.from({ length: rowCount }, (_, rowIdx) => {
          const start = rowIdx * matrixCols;
          const rowItems = items.slice(start, start + matrixCols);
          const rowCols = rowMatrixCols(matrixCols, rowItems.length);
          const colsClass = matrixColsClass(rowCols);
          return (
            <div
              key={`row-${rowIdx}`}
              className={`grid ${colsClass} divide-y divide-app-border sm:divide-y-0 sm:divide-x sm:divide-app-border ${
                rowIdx > 0 ? 'border-t border-app-border' : ''
              }`}
            >
              {rowItems.map((item, colIdx) => {
                const i = start + colIdx;
                const stamp = changedAt.get(i);
                const isFirstRow = rowIdx === 0;
                const isLastRow = rowIdx === rowCount - 1;
                const isFirstCol = colIdx === 0;
                const isLastCol = colIdx === rowItems.length - 1;
                // Match the outer card radius on corner cells so the active ring fits.
                const cornerRadius = [
                  isFirstRow && isFirstCol ? 'rounded-tl-[inherit] sm:rounded-tl-xl' : '',
                  isFirstRow && isLastCol ? 'rounded-tr-[inherit] sm:rounded-tr-xl' : '',
                  isLastRow && isFirstCol ? 'rounded-bl-[inherit] sm:rounded-bl-xl' : '',
                  isLastRow && isLastCol ? 'rounded-br-[inherit] sm:rounded-br-xl' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const inner = (
                  <>
                    <span className="text-xs text-app-fg-muted shrink-0 pr-3">{item.label}</span>
                    {loading ? (
                      matrixValueSkeleton
                    ) : item.plainValue ? (
                      <div className="min-w-0 text-right flex items-center justify-end gap-1">
                        {item.value}
                        {stamp !== undefined && <LiveFlashArrow key={stamp} />}
                      </div>
                    ) : (
                      <span
                        className={`min-w-0 text-right font-medium tabular-nums ${item.valueClassName ?? 'text-app-fg'}`}
                      >
                        {item.value}
                        {stamp !== undefined && <LiveFlashArrow key={stamp} />}
                      </span>
                    )}
                  </>
                );
                const cellClass = [
                  'flex items-center justify-between gap-3 px-4 sm:px-3 py-2.5 min-w-0',
                  item.active ? `${activeMatrixTileClass} ${cornerRadius}` : '',
                  item.itemClassName ?? '',
                  tileClassName,
                ]
                  .filter(Boolean)
                  .join(' ');
                if (item.to) {
                  return (
                    <Link
                      key={i}
                      to={resolveHref(item.to)}
                      onClick={item.onClick}
                      className={`${cellClass} ${clickableTileClass}`}
                      title={item.title}
                    >
                      {inner}
                    </Link>
                  );
                }
                if (item.onClick) {
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={item.onClick}
                      className={`${cellClass} ${clickableTileClass} w-full text-left`}
                      title={item.title}
                    >
                      {inner}
                    </button>
                  );
                }
                return (
                  <div key={i} className={cellClass} title={item.title}>
                    {inner}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );

    if (embedded) {
      return <div className={className}>{matrixBody}</div>;
    }
    return (
      <div className={['card', '!p-0', 'overflow-hidden', className].filter(Boolean).join(' ')}>
        {matrixBody}
      </div>
    );
  }

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
        style={{ display: 'grid', gridTemplateColumns: `repeat(${mobileGridCols}, 1fr)` }}
      >
      {items.map((item, i) => {
        const stamp = changedAt.get(i);
        const inner = (
          <>
            <p className="truncate text-micro font-medium text-app-fg-muted uppercase tracking-wider flex items-center justify-center gap-1">{item.label}</p>
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
          <Link key={i} to={resolveHref(item.to!)} onClick={item.onClick} className={`${gridTile} ${clickableTileClass} ${activeClass} ${itemCls}`} title={item.title}>
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
              <p className={`truncate ${labelClass} flex items-center justify-center gap-1`}>{item.label}</p>
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
            <Link key={i} to={resolveHref(item.to!)} onClick={item.onClick} className={`${tileBase} ${clickableTileClass} ${activeClass} ${itemCls}`} title={item.title}>
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
