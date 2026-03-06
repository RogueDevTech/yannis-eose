import { Suspense, type ReactNode } from 'react';
import { Await, useRevalidator } from '@remix-run/react';

// ── Skeleton Variants ────────────────────────────────────────

function StatSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-surface-200 dark:bg-surface-700" />
        <div className="w-8 h-8 rounded-lg bg-surface-200 dark:bg-surface-700" />
      </div>
      <div className="h-7 w-24 rounded bg-surface-200 dark:bg-surface-700 mt-3" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="card animate-pulse space-y-3">
      <div className="h-4 w-32 rounded bg-surface-200 dark:bg-surface-700" />
      <div className="h-3 w-full rounded bg-surface-100 dark:bg-surface-800" />
      <div className="h-3 w-3/4 rounded bg-surface-100 dark:bg-surface-800" />
      <div className="h-3 w-5/6 rounded bg-surface-100 dark:bg-surface-800" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="card animate-pulse space-y-2">
      <div className="h-4 w-40 rounded bg-surface-200 dark:bg-surface-700 mb-3" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 py-2">
          <div className="h-3 w-1/4 rounded bg-surface-100 dark:bg-surface-800" />
          <div className="h-3 w-1/3 rounded bg-surface-100 dark:bg-surface-800" />
          <div className="h-3 w-1/6 rounded bg-surface-100 dark:bg-surface-800" />
          <div className="h-3 w-1/6 rounded bg-surface-100 dark:bg-surface-800" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="card animate-pulse divide-y divide-surface-100 dark:divide-surface-800">
      <div className="h-4 w-48 rounded bg-surface-200 dark:bg-surface-700 mb-4" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 py-4">
          <div className="h-8 w-8 rounded-full bg-surface-200 dark:bg-surface-700 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-surface-100 dark:bg-surface-800" />
            <div className="flex gap-4">
              <div className="h-3 w-16 rounded bg-surface-100 dark:bg-surface-800" />
              <div className="h-3 w-20 rounded bg-surface-100 dark:bg-surface-800" />
              <div className="h-3 w-14 rounded bg-surface-100 dark:bg-surface-800" />
            </div>
          </div>
          <div className="h-6 w-12 rounded bg-surface-200 dark:bg-surface-700 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function InlineSkeleton() {
  return (
    <div className="flex items-center gap-2 py-1">
      <svg className="animate-spin h-4 w-4 text-surface-700 dark:text-surface-300" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span className="text-xs text-surface-700 dark:text-surface-300">Loading...</span>
    </div>
  );
}

const SKELETON_COMPONENTS: Record<SkeletonVariant, () => ReactNode> = {
  stat: StatSkeleton,
  card: CardSkeleton,
  table: TableSkeleton,
  list: ListSkeleton,
  inline: InlineSkeleton,
};

// ── Error Fallback ───────────────────────────────────────────

export function DeferredError() {
  const { revalidate, state } = useRevalidator();

  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-danger-500 dark:text-danger-400" title="Section failed to load. Click to retry.">
      <button
        type="button"
        onClick={() => revalidate()}
        disabled={state === 'loading'}
        className="flex items-center justify-center p-1 rounded-md hover:bg-danger-50 dark:hover:bg-danger-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label={state === 'loading' ? 'Retrying…' : 'Retry loading this section'}
      >
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        {state === 'loading' && (
          <svg className="w-3.5 h-3.5 ml-0.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

type SkeletonVariant = 'stat' | 'card' | 'table' | 'list' | 'inline';

interface DeferredSectionProps<T> {
  resolve: Promise<T> | T;
  children: (data: T) => ReactNode;
  skeleton?: SkeletonVariant;
  /** When provided, used as Suspense fallback instead of the skeleton variant. */
  fallback?: ReactNode;
  errorElement?: ReactNode;
}

/**
 * Wraps Remix <Await> + <Suspense> for streaming deferred data.
 *
 * Usage:
 * ```tsx
 * <DeferredSection resolve={data.profit} skeleton="stat">
 *   {(profit) => <StatCard label="True Profit" value={profit.trueProfit} />}
 * </DeferredSection>
 * ```
 */
export function DeferredSection<T>({
  resolve,
  children,
  skeleton = 'card',
  fallback,
  errorElement,
}: DeferredSectionProps<T>) {
  const SkeletonComponent = SKELETON_COMPONENTS[skeleton];
  const suspenseFallback = fallback ?? <SkeletonComponent />;

  return (
    <Suspense fallback={suspenseFallback}>
      <Await resolve={resolve} errorElement={errorElement ?? <DeferredError />}>
        {(data) => <>{children(data as T)}</>}
      </Await>
    </Suspense>
  );
}

// ── Multi-Stat Skeleton (for grid of stat cards) ─────────────

export function StatSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <StatSkeleton key={i} />
      ))}
    </>
  );
}
