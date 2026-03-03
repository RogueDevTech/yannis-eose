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

function InlineSkeleton() {
  return (
    <div className="flex items-center gap-2 py-1">
      <svg className="animate-spin h-4 w-4 text-surface-700 dark:text-surface-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span className="text-xs text-surface-700 dark:text-surface-500">Loading...</span>
    </div>
  );
}

const SKELETON_COMPONENTS: Record<SkeletonVariant, () => ReactNode> = {
  stat: StatSkeleton,
  card: CardSkeleton,
  table: TableSkeleton,
  inline: InlineSkeleton,
};

// ── Error Fallback ───────────────────────────────────────────

function DeferredError() {
  const { revalidate, state } = useRevalidator();

  return (
    <div className="card border-danger-200 dark:border-danger-700/50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-danger-600 dark:text-danger-400">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>Failed to load this section</span>
        </div>
        <button
          type="button"
          onClick={() => revalidate()}
          disabled={state === 'loading'}
          className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === 'loading' ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

type SkeletonVariant = 'stat' | 'card' | 'table' | 'inline';

interface DeferredSectionProps<T> {
  resolve: Promise<T> | T;
  children: (data: T) => ReactNode;
  skeleton?: SkeletonVariant;
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
  errorElement,
}: DeferredSectionProps<T>) {
  const SkeletonComponent = SKELETON_COMPONENTS[skeleton];

  return (
    <Suspense fallback={<SkeletonComponent />}>
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
