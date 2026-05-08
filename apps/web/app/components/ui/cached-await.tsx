import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useRevalidator } from '@remix-run/react';
import { getCachedLoaderEntry, setCachedLoaderEntry } from '~/lib/loader-cache';

/**
 * Drop-in replacement for `<Suspense fallback>` + `<Await resolve>` that
 * unlocks LinkedIn-style "instant revisit" navigation:
 *
 *  - First visit: behaves identically to Suspense+Await — `fallback` renders
 *    while the deferred promise resolves; once resolved, `children(data)`
 *    renders and the result is snapshotted into the cache.
 *
 *  - Revisit (cache hit, within TTL): `children(cached)` renders **immediately**,
 *    bypassing the `fallback` entirely. In parallel, `useRevalidator().revalidate()`
 *    fires so Remix re-runs the loaders and the new deferred promise resolves
 *    over the cached data within a few hundred ms. Net: no skeleton flash on
 *    revisit, fresh data lands within an SLA the user perceives as "live."
 *
 *  - Revisit (cache miss / expired): identical to first visit.
 *
 * Usage:
 *
 *   return (
 *     <CachedAwait resolve={pageData} fallback={<MyLoadingShell/>}>
 *       {(data) => <MyPage {...data} />}
 *     </CachedAwait>
 *   );
 *
 * Cache key is `location.pathname + location.search`, so `/orders?status=PENDING`
 * and `/orders?status=DELIVERED` are independent entries.
 *
 * NOT a fit for routes whose data ages by the second (live order pipeline,
 * stocked-batch counts) — keep `<Suspense fallback>` + `<Await>` there so
 * stale data is never shown.
 */
export function CachedAwait<T>({
  resolve,
  fallback,
  children,
  errorElement,
}: {
  resolve: Promise<T> | T;
  fallback: ReactNode;
  children: (data: T) => ReactNode;
  /**
   * Custom render for the rejected branch. Default: a centered card with the error
   * message and a Retry button that fires `revalidator.revalidate()`.
   */
  errorElement?: (err: Error, retry: () => void) => ReactNode;
}) {
  const location = useLocation();
  const revalidator = useRevalidator();
  const cacheKey = location.pathname + location.search;
  const cachedRef = useRef(getCachedLoaderEntry(cacheKey));
  const [resolved, setResolved] = useState<T | null>(
    cachedRef.current ? (cachedRef.current.data as T) : null,
  );
  const [error, setError] = useState<Error | null>(null);

  // Resolve the live deferred promise; on settle, snapshot into cache and
  // swap to fresh data. The dependency on `resolve` re-runs this effect when
  // the loader produces a new promise (e.g. after revalidation or filter
  // change), which is exactly what we want.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.resolve(resolve)
      .then((data) => {
        if (cancelled) return;
        setCachedLoaderEntry(cacheKey, data);
        setResolved(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Surface the rejection so the user gets a recoverable error UI.
        // Without this the fallback skeleton renders forever (silent failure).
        setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [resolve, cacheKey]);

  // On mount with a fresh cache hit, kick off background revalidation so the
  // user sees fresh data within ~300ms even though they're already looking at
  // the cached snapshot. Mount-only — subsequent renders shouldn't re-trigger.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (cachedRef.current) {
      // We started with a cache hit — fire revalidation so fresh data lands.
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: mount-only
  }, []);

  // Error UI: render only if we have NO data to fall back to. If a cache hit
  // is already showing, keep the cached view + let the toast/page handle the
  // background failure quietly — yanking working content for an error card is
  // worse UX than a stale snapshot.
  if (error && resolved === null) {
    const retry = () => {
      setError(null);
      revalidator.revalidate();
    };
    if (errorElement) return <>{errorElement(error, retry)}</>;
    return (
      <div className="rounded-lg border border-danger-200 dark:border-danger-700 bg-danger-50/60 dark:bg-danger-900/20 p-6 text-center space-y-3">
        <div>
          <p className="text-sm font-semibold text-danger-800 dark:text-danger-200">
            Couldn’t load this section
          </p>
          <p className="text-xs text-danger-700 dark:text-danger-300 mt-1">
            {error.message || 'The server took too long to respond.'}
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={revalidator.state === 'loading'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-danger-600 text-white text-sm font-medium hover:bg-danger-700 disabled:opacity-60"
        >
          {revalidator.state === 'loading' ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  if (resolved !== null) {
    return <>{children(resolved)}</>;
  }
  return <>{fallback}</>;
}
