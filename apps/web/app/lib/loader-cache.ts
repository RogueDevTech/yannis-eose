/**
 * Client-side loader-data cache for "instant revisit" navigation.
 *
 * When the user opens page A → leaves to page B → comes back to A, render A's
 * last-seen data immediately (cache hit) and trigger background revalidation
 * to refresh stale data. Same UX pattern LinkedIn / Twitter / Facebook use.
 *
 * Storage: in-memory Map keyed by `pathname + search`. Cleared on hard reload
 * (browser drops module memory) and on logout (`clearLoaderCache()` is called
 * from the logout action). LRU-evicted at `MAX` entries; TTL'd at `TTL_MS`.
 *
 * Stale-while-revalidate contract:
 *  - Cache hit + within TTL → render cached data instantly, kick off
 *    `useRevalidator().revalidate()` so fresh data replaces it within ~300ms.
 *  - Cache miss or expired → fall through to standard loader behavior.
 *
 * Mutation invalidation: same-page mutations naturally update the cache via
 * Remix's automatic post-action revalidation (we re-snapshot on every settled
 * render). Cross-page mutations (mutate on B, revisit A) show stale data
 * briefly until the always-revalidate-on-revisit completes.
 *
 * Do NOT use for pages with sensitive PII or financial reads where momentary
 * stale data could mislead a decision — those should keep using `useLoaderData`
 * directly.
 */

interface CacheEntry {
  data: unknown;
  ts: number;
}

/** 5 minutes. Pages older than this fall back to a fresh loader run. */
const TTL_MS = 5 * 60 * 1000;
/** LRU bound. Roughly 30 distinct route+filter combinations, plenty for one session. */
const MAX_ENTRIES = 30;

const cache = new Map<string, CacheEntry>();

/** Read a fresh entry. Returns null if missing or expired. */
export function getCachedLoaderEntry(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

/**
 * Snapshot loader data into the cache. Re-running with the same key + same
 * data is a no-op (saves an LRU shuffle on every settled render).
 */
export function setCachedLoaderEntry(key: string, data: unknown): void {
  // Don't cache nullish / non-object data — usually means the loader hasn't
  // resolved yet or the route returned an error placeholder.
  if (data == null) return;

  const existing = cache.get(key);
  if (existing && existing.data === data) {
    // Same reference → just bump the timestamp.
    existing.ts = Date.now();
    return;
  }

  cache.set(key, { data, ts: Date.now() });

  if (cache.size > MAX_ENTRIES) {
    // LRU evict — drop the oldest by timestamp. O(n) but n ≤ 31, negligible.
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey != null) cache.delete(oldestKey);
  }
}

/**
 * Wipe the entire cache. Called from the logout action so a different user
 * signing into the same browser tab cannot read the previous user's cached
 * loader payloads.
 */
export function clearLoaderCache(): void {
  cache.clear();
}

/**
 * Drop one URL's cache entry. Useful for explicit cache busting after a
 * mutation that affects another page (e.g. creating an order from page A
 * could call `invalidateCachedLoader('/admin/cs/orders')` to ensure the next
 * revisit shows the new row immediately rather than waiting for the
 * background revalidate to land).
 */
export function invalidateCachedLoader(pathname: string): void {
  // Match by prefix so `/admin/cs/orders?status=PENDING` etc. all drop.
  for (const k of [...cache.keys()]) {
    if (k === pathname || k.startsWith(`${pathname}?`)) {
      cache.delete(k);
    }
  }
  // Also drop the full-loader cache so clientLoader doesn't serve stale
  // route shape after explicit invalidation.
  for (const k of [...fullCache.keys()]) {
    if (k === pathname || k.startsWith(`${pathname}?`)) {
      fullCache.delete(k);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Full-loader cache — used by `clientLoader` to skip the server roundtrip
// entirely on revisit, giving true LinkedIn-style instant navigation.
//
// Why a second cache: the original `cache` above stores ONLY the resolved
// deferred portion (whatever `<CachedAwait resolve={pageData}>` snapshots).
// `clientLoader` needs the WHOLE loader return shape — synchronous shell
// (`csOrdersShell`, `financeShell`, etc.) AND the resolved deferred — so it
// can serve `useLoaderData()` immediately without any network call.
//
// Populated by `<CachedAwait>` when it receives both `loaderShell` and a
// `deferredKey` prop (opt-in per route).
// ───────────────────────────────────────────────────────────────────────────

interface FullCacheEntry {
  /** Full loader return value with deferred promises pre-resolved. */
  data: unknown;
  ts: number;
}

const fullCache = new Map<string, FullCacheEntry>();

export function getFullLoaderEntry(key: string): unknown | null {
  const entry = fullCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= TTL_MS) {
    fullCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setFullLoaderEntry(key: string, data: unknown): void {
  if (data == null) return;
  const existing = fullCache.get(key);
  if (existing && existing.data === data) {
    existing.ts = Date.now();
    return;
  }
  fullCache.set(key, { data, ts: Date.now() });
  if (fullCache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of fullCache) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey != null) fullCache.delete(oldestKey);
  }
}

/**
 * Reusable `clientLoader` for routes that opted into full-loader caching.
 *
 * On a client-side navigation:
 *  - Cache hit (TTL fresh) → return cached `useLoaderData` shape immediately.
 *    Remix mounts the route on the same tick — NO server roundtrip, NO
 *    skeleton flash. After mount, `<CachedAwait>` fires `revalidator.revalidate()`
 *    which re-runs `clientLoader`; on that revalidation we bypass the cache and
 *    call `serverLoader()` so fresh data lands.
 *  - Cache miss → fall through to `serverLoader()`.
 *
 * Usage in a route file:
 *
 *   import { cachedClientLoader } from '~/lib/loader-cache';
 *   export const clientLoader = cachedClientLoader;
 *   clientLoader.hydrate = false;
 *
 * Pair with `<CachedAwait>` configured with `loaderShell` + `deferredKey` so
 * the cache gets populated on first visit.
 */
/**
 * In-flight revalidation tracker — when a cached payload is served, we stamp
 * the URL with a timestamp so the very next loader run (the on-mount revalidate
 * fired by `<CachedAwait>`) bypasses the cache and fetches fresh data. The
 * TTL is a safety net: if the user navigates away before the revalidate fires,
 * the flag becomes stale and the next visit can hit the cache again.
 */
const inFlightRevalidations = new Map<string, number>();
/** Window during which a stamped URL forces a fresh fetch. Long enough for the
 *  revalidator to fire (it runs in a useEffect, ~50ms after mount); short
 *  enough that an interrupted navigation doesn't lock the cache out for long. */
const REVALIDATE_FLAG_MS = 5_000;

/**
 * Type matches Remix's `ClientLoaderFunctionArgs` shape without importing
 * the type (avoids a Remix-version coupling at the cache layer).
 */
interface CachedClientLoaderArgs {
  request: Request;
  serverLoader: () => Promise<unknown>;
}

interface CachedClientLoaderFn {
  (args: CachedClientLoaderArgs): Promise<unknown>;
  /** Remix flag: when `true`, also runs on initial SSR hydration. Default `false`. */
  hydrate?: boolean;
}

const cachedClientLoaderImpl = async (
  args: CachedClientLoaderArgs,
): Promise<unknown> => {
  const url = new URL(args.request.url);
  const key = url.pathname + url.search;

  // If a fresh revalidation flag exists, fall through to the server (this is
  // the on-mount revalidate triggered by `<CachedAwait>` after the cached
  // shape rendered — we want fresh data this time).
  const flagged = inFlightRevalidations.get(key);
  if (flagged != null && Date.now() - flagged < REVALIDATE_FLAG_MS) {
    inFlightRevalidations.delete(key);
    const fresh = await args.serverLoader();
    return fresh;
  }
  if (flagged != null) {
    // Stale flag (user navigated away before revalidate fired) — drop it and
    // fall through to the cache check below.
    inFlightRevalidations.delete(key);
  }

  const cached = getFullLoaderEntry(key);
  if (cached !== null) {
    // Stamp the key so the next revalidation tick fetches fresh data.
    inFlightRevalidations.set(key, Date.now());
    return cached;
  }

  return args.serverLoader();
};

export const cachedClientLoader: CachedClientLoaderFn = cachedClientLoaderImpl;
