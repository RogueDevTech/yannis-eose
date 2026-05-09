import { useEffect } from 'react';
import { useLocation } from '@remix-run/react';
import { setFullLoaderEntry } from '~/lib/loader-cache';

/**
 * Companion to `<CachedAwait loaderShell deferredKey>` for routes whose loader
 * returns MULTIPLE deferred promises (e.g. `admin.marketing.orders._index`
 * with `listPromise` + `secondaryPromise`).
 *
 * `<CachedAwait>` only knows about ONE deferred; it can't write the full
 * multi-promise loader shape to the `setFullLoaderEntry` cache that
 * `clientLoader` reads. This hook fills that gap: when ALL named deferred
 * promises settle, it writes the reconstructed `useLoaderData()` shape
 * (synchronous shell + each resolved deferred) into the full cache.
 *
 * On revisit, `cachedClientLoader` returns the cached shape and Remix mounts
 * the route on the same React tick — no server roundtrip, no skeleton flash.
 *
 * Usage:
 *
 *   useMultiDeferredCacheSync({
 *     shell: { ordersShell },
 *     deferred: { listPromise, secondaryPromise },
 *   });
 *
 * The cache key is `pathname + search` (matches `<CachedAwait>` and
 * `cachedClientLoader`). Cache TTL: 5 minutes (set by `loader-cache.ts`).
 */
export function useMultiDeferredCacheSync({
  shell,
  deferred,
}: {
  /** Synchronous portion of the loader response. */
  shell: Record<string, unknown>;
  /** Map of deferredKey → Promise. All must resolve before the cache is written. */
  deferred: Record<string, Promise<unknown> | unknown>;
}): void {
  const location = useLocation();
  const cacheKey = location.pathname + location.search;
  // Stable signature for re-running the effect on actual value changes.
  // Promises identity-change per loader run; that's what we want here.
  const deferredEntries = Object.entries(deferred);
  const deferredRefSig = deferredEntries.map(([k]) => k).join('|');

  useEffect(() => {
    let cancelled = false;
    const resolveAll = async () => {
      const resolved: Record<string, unknown> = {};
      await Promise.all(
        deferredEntries.map(async ([k, p]) => {
          resolved[k] = await Promise.resolve(p);
        }),
      );
      if (cancelled) return;
      setFullLoaderEntry(cacheKey, { ...shell, ...resolved });
    };
    void resolveAll().catch(() => {
      // If any deferred rejects, skip caching — better to refetch on revisit
      // than to cache a half-broken payload.
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shell/deferred captured by reference; cacheKey + deferredRefSig drive re-runs
  }, [cacheKey, deferredRefSig, ...Object.values(deferred)]);
}
