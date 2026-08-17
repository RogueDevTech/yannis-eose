import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigation, useRevalidator } from '@remix-run/react';
import {
  getCachedLoaderEntry,
  setCachedLoaderEntry,
  setFullLoaderEntry,
} from '~/lib/loader-cache';
import { runSafeRevalidate } from '~/lib/safe-revalidate';

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
  loaderShell,
  deferredKey,
  dimOnRefresh = true,
}: {
  resolve: Promise<T> | T;
  fallback: ReactNode;
  children: (data: T) => ReactNode;
  /**
   * Custom render for the rejected branch. Default: a centered card with the error
   * message and a Retry button that fires `revalidator.revalidate()`.
   */
  errorElement?: (err: Error, retry: () => void) => ReactNode;
  /**
   * Synchronous portion of the loader response (e.g. `csOrdersShell`,
   * `financeShell`). When BOTH `loaderShell` AND `deferredKey` are provided,
   * CachedAwait writes the full reconstructed loader shape to the
   * `setFullLoaderEntry` cache so a `clientLoader` can serve the entire
   * `useLoaderData()` payload on revisit — skipping the server roundtrip
   * entirely (true LinkedIn-style instant navigation).
   *
   * Pass the shell as a plain object — Remix's loader response shape minus
   * the deferred field. Example: `{ csOrdersShell }`.
   */
  loaderShell?: Record<string, unknown>;
  /**
   * Key in the loader response under which the deferred Promise lives —
   * e.g. `'pageData'`. When provided alongside `loaderShell`, CachedAwait
   * writes `{ ...loaderShell, [deferredKey]: <resolved> }` to the full cache.
   */
  deferredKey?: string;
  /**
   * When true (default), cached content dims to opacity-60 while a revalidation
   * is in flight — the right cue for user-initiated refetches (filter/page changes).
   *
   * Set false for live-updating pages that revalidate on a silent background
   * interval (Form Analytics, live dashboards). There, a LIVE indicator already
   * signals the refresh, and CachedAwait is stale-while-revalidate: content stays
   * put and only the changed numbers animate. Dimming the whole page every poll
   * tick reads as a full-page flash, which is exactly what those pages avoid.
   */
  dimOnRefresh?: boolean;
}) {
  const location = useLocation();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const cacheKey = location.pathname + location.search;
  const cachedRef = useRef(getCachedLoaderEntry(cacheKey));
  const [resolved, setResolved] = useState<T | null>(
    cachedRef.current ? (cachedRef.current.data as T) : null,
  );
  const [error, setError] = useState<Error | null>(null);

  // Track the cacheKey the current `resolved` belongs to. When the URL changes
  // (pagination, filter) and there's no cache hit for the new key, clear
  // `resolved` so the fallback skeleton shows instead of stale data from the
  // previous page. Without this, clicking "Next" renders page 1 data under
  // page 2 props while the promise resolves — and `isLoaderRefetchBusy` keeps
  // the skeleton overlay stuck because navigation already completed.
  const resolvedForKeyRef = useRef(cacheKey);
  const prevPathnameRef = useRef(location.pathname);
  if (cacheKey !== resolvedForKeyRef.current) {
    const prevPathname = prevPathnameRef.current;
    prevPathnameRef.current = location.pathname;
    resolvedForKeyRef.current = cacheKey;
    const freshCache = getCachedLoaderEntry(cacheKey);
    cachedRef.current = freshCache;
    const isSamePageFilterChange = location.pathname === prevPathname;
    if (freshCache && !isSamePageFilterChange) {
      // Cross-page cache hit — show it immediately (stale-while-revalidate).
      setResolved(freshCache.data as T);
    } else if (!freshCache && !resolved) {
      // No cache and no current data — show fallback skeleton.
      setResolved(null);
    }
    // Same-page filter change (with or without cache): keep showing current
    // data behind the TableLoadingOverlay until the fresh promise resolves.
    // This prevents the jarring flash of stale cached data from a prior visit.
  }

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
        if (loaderShell && deferredKey) {
          setFullLoaderEntry(cacheKey, { ...loaderShell, [deferredKey]: data });
        }
        setResolved(data);
        resolvedForKeyRef.current = cacheKey;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [resolve, cacheKey, loaderShell, deferredKey]);

  // On mount with a fresh cache hit, kick off background revalidation so the
  // user sees fresh data within ~300ms even though they're already looking at
  // the cached snapshot. Mount-only — subsequent renders shouldn't re-trigger.
  //
  // After a backgrounded PWA resumes, remount + revalidate races the network
  // stack. App-wide settle gate defers until it's safe (any page, not just this one).
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (!cachedRef.current) return;
    runSafeRevalidate(() => revalidator.revalidate());
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
    // When showing cached data while refreshing, apply a subtle opacity
    // transition so users know numbers are updating. Two triggers:
    //  1. an explicit revalidation (useRevalidator), and
    //  2. a SAME-PATH navigation load — i.e. a filter/param change like the
    //     currency switch, where the URL changes but the pathname stays put.
    //     Without (2), changing a query param re-fetched silently and the
    //     numbers appeared frozen until the new data landed.
    const samePathNavLoading =
      navigation.state === 'loading' &&
      !!navigation.location &&
      navigation.location.pathname === location.pathname;
    const isRefreshing =
      dimOnRefresh &&
      cachedRef.current !== null &&
      (revalidator.state === 'loading' || samePathNavLoading);
    return (
      <div className={isRefreshing ? 'opacity-60 transition-opacity duration-300' : 'transition-opacity duration-300'}>
        {children(resolved)}
      </div>
    );
  }
  return <>{fallback}</>;
}
