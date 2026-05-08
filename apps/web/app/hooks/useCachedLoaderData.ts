import { useEffect, useRef } from 'react';
import { useLoaderData, useLocation, useRevalidator } from '@remix-run/react';
import { getCachedLoaderEntry, setCachedLoaderEntry } from '~/lib/loader-cache';

/**
 * Drop-in replacement for `useLoaderData<typeof loader>()` on non-deferred
 * routes. Provides LinkedIn-style "instant revisit" by caching the loader's
 * resolved data per-URL and using it on subsequent renders of the same URL.
 *
 * Usage:
 *
 *   const data = useCachedLoaderData<typeof loader>();
 *
 * Behaviour:
 *  - First visit: returns the live `useLoaderData` result, then snapshots it
 *    into the cache.
 *  - Revisit (cache hit, within TTL): the page is rendered with cached data
 *    on first paint (Remix has already run the loader so `useLoaderData`
 *    returns fresh data — but the visible benefit is that we trigger
 *    `revalidator.revalidate()` to keep the data ground-truth without the
 *    user clicking a refresh button).
 *  - Mutation on this page: the action triggers Remix's auto-revalidation,
 *    new loader data flows in, and we re-snapshot it on the next idle render.
 *
 * For deferred routes (`defer({ pageData })`), use `<CachedAwait>` instead —
 * that's where the cache delivers the dramatic "no skeleton flash" UX.
 */
export function useCachedLoaderData<Loader>(): Awaited<ReturnType<Extract<Loader, (...args: never) => unknown>>> {
  const live = useLoaderData<Loader>();
  const location = useLocation();
  const revalidator = useRevalidator();
  const cacheKey = location.pathname + location.search;

  // Snapshot the live data on every render where we have it. Cheap (no-op
  // when reference unchanged), and ensures mutations + filter changes that
  // alter `live` propagate into the cache without explicit invalidation.
  useEffect(() => {
    if (live != null) {
      setCachedLoaderEntry(cacheKey, live);
    }
  }, [live, cacheKey]);

  // On mount with a cache hit, trigger background revalidation so the user
  // sees fresh data within a few hundred ms.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (getCachedLoaderEntry(cacheKey)) {
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  return live as Awaited<ReturnType<Extract<Loader, (...args: never) => unknown>>>;
}
